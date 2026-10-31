import * as THREE from 'three'
import { WebGPURenderer, PMREMGenerator } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EXPOSED, RECORD_RADIUS } from './layout'
import { createPlankGeometry, createSleeveGeometry } from './geometry'
import { createWoodMaterial } from './wood-material'
import {
  createDiscTexture,
  updateDiscTexture,
  createSleeveTexture,
  getVinylMaps,
  getSleevePaperMaps,
  loadOakMaps,
  type OakMaps,
  loadCoverBlob,
  prepareTextureMaps,
} from './textures'
import {
  CRATE_ROTATION,
  FLIP_SECONDS,
  crateSleevePose,
  createCrateModel,
  fitCrate,
  hidesStack,
  moveSlot,
  pickUp,
  placeSlot,
  raisePose,
  settleSlots,
  type CrateModel,
  type CratePose,
  type CrateSlot,
} from './crate'

export type SleeveInfo = { id: number; artist: string; title: string; coverUrl: string | null }

const FOV = 30
const RECORD_THICKNESS = 0.005
const SLIDE_DISTANCE = 0.5 + RECORD_RADIUS * 2 * EXPOSED - RECORD_RADIUS
const LEAN = -0.06
const HOVER_TILT = 0.16
const FRONT_Z = 90
const SCRIM_Z = 45
const PLANK_FRONT = 18
const PLANK_DEPTH = 56
const WALL_Z = PLANK_FRONT - PLANK_DEPTH
const SPIN_SPEED = (100 / 3 / 60) * Math.PI * 2
const TRAVEL_SECONDS = 0.32
const SHELF_CLEARANCE_FRACTION = 0.3
const SLIDE_SECONDS = 0.35
const SCRIM_OPACITY = 0.94
// The wood shader's distance filtering is designed for metre-scale scenes.
const WORLD_SCALE = 0.001
// The largest shelf cover is ~460 device pixels at the renderer's DPR cap.
const SHELF_TEXTURE_SIZE = 512
const SELECTED_TEXTURE_SIZE = 1024
const MAX_RETAINED_SLEEVES = 24
const RETAINED_ARTWORK_BYTES = 64 * 1024 * 1024
// Records come out of a crate more slowly: up, clear of the others, then forward. The forward
// move starts while the lift is still easing off, once the sleeve has cleared its neighbours.
const CRATE_TRAVEL_SECONDS = 0.6
const CRATE_LIFT_FRACTION = 0.4
const CRATE_MOVE_START = 0.26
const CRATE_LIFT = 1.06
// Fade the crate only once the record is in front of the scrim, so it is never dimmed with it.
const CRATE_SCRIM_START = SCRIM_Z + 20

type Pose = { x: number; y: number; z: number; size: number; rx: number; ry: number }

type Sleeve = {
  info: SleeveInfo
  element: HTMLElement
  group: THREE.Group
  front: THREE.MeshStandardMaterial
  texture: THREE.CanvasTexture<ImageBitmap> | null
  abort: AbortController
  cover: Blob | null
  nearby: boolean
  /** How far the hover tilt has eased in, from 0 to 1. */
  tilt: number
}

type Selection = {
  sleeve: Sleeve
  stage: HTMLElement
  disc: THREE.Mesh
  material: THREE.MeshPhysicalMaterial
  open: boolean
  travel: number
  slide: number
  speed: number
  angle: number
  onClosed: (() => void) | null
  artworkAbort: AbortController
  artwork: THREE.CanvasTexture<ImageBitmap> | null
}

type Crate = {
  element: HTMLElement
  model: CrateModel
  slots: Map<HTMLElement, CrateSlot>
  count: number
  /** How long a flip takes, set by the latest flip. */
  seconds: number
  /** Called once nothing in the crate is moving. */
  onSettle?: () => void
  /**
   * Places to switch to once the records behind the front one are out of sight: while the record
   * `carried` out to the front hides them on its way down, or else once the crate is at rest.
   */
  restack?: { offsets: Map<HTMLElement, number>; carried?: HTMLElement }
  /** Called once the records have switched to their `restack` places. */
  onRestack?: () => void
}

type Preview = { disc: THREE.Mesh; material: THREE.MeshPhysicalMaterial; texture: ReturnType<typeof createDiscTexture> }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
const step = (current: number, target: number, delta: number) =>
  target > current ? Math.min(target, current + delta) : Math.max(target, current - delta)

const scratch = {
  matrix: new THREE.Matrix4(),
  local: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  euler: new THREE.Euler(),
  one: new THREE.Vector3(1, 1, 1),
  pointer: new THREE.Vector2(),
  ray: new THREE.Ray(),
  hit: new THREE.Vector3(),
}
const raycaster = new THREE.Raycaster()
const SLEEVE_BOX = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.0125), new THREE.Vector3(0.5, 1, 0.0125))
const UNIT_BOX = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))

/**
 * Draws every sleeve and shelf in one fixed, full-viewport canvas. The page lays out invisible
 * slot elements; each frame the 3D objects are placed over their slots, so scrolling, hit testing
 * and keyboard focus stay in the DOM. Poses use CSS pixels, scaled to metres by the scene.
 */
export class ShelfScene {
  private readonly renderer: WebGPURenderer
  private readonly woodNodes: boolean
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10_000)
  private readonly light = new THREE.DirectionalLight(0xffffff, 1.8)
  private readonly environment: THREE.Texture
  private readonly wall: THREE.Mesh
  private readonly scrim: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly sleeveGeometry = createSleeveGeometry()
  private readonly discGeometry = new THREE.CylinderGeometry(
    RECORD_RADIUS,
    RECORD_RADIUS,
    RECORD_THICKNESS,
    160,
  ).rotateX(Math.PI / 2)
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c1b1, roughness: 0.95 })
  private readonly backMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d1c1, roughness: 0.95 })
  private readonly rimMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.35 })
  // Keep the mapped shader in use while artwork loads, including between lazy-loaded rows.
  private readonly placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  private readonly plankOffsets = new WeakMap<HTMLElement, number>()
  // Retain visited planks so hiding every row cannot evict the shared shader.
  // The separate `planks` map contains only rows that need layout updates and drawing.
  private readonly plankCache = new Map<HTMLElement, {
    mesh: THREE.Mesh
    wood: ReturnType<typeof createWoodMaterial>
  }>()
  private readonly observer: IntersectionObserver
  private readonly resizeObserver: ResizeObserver
  private readonly tracked = new Map<HTMLElement, SleeveInfo | 'plank'>()
  private readonly sleeves = new Map<HTMLElement, Sleeve>()
  // Only detached, inactive sleeves live here, in least-recently-used order.
  private readonly sleeveCache = new Map<HTMLElement, Sleeve>()
  private readonly planks = new Map<HTMLElement, THREE.Mesh>()
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private hovered: number | null = null
  private selection: Selection | null = null
  private width = 1
  private height = 1
  private viewportReady = false
  private distance = 1
  private frame = 0
  private lastTime = 0
  private layoutObserved = false
  private disposed = false
  private preview: Preview | null = null
  private previewWarmTimer: ReturnType<typeof setTimeout> | null = null
  private previewWarming: Promise<void> | null = null
  private crate: Crate | null = null

  static async create(canvas: HTMLCanvasElement, onReady: () => void = () => {}): Promise<ShelfScene> {
    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: true })
    try {
      await renderer.init()
      const [oak] = await Promise.all([
        loadOakMaps(renderer.getMaxAnisotropy()),
        prepareTextureMaps(),
      ])
      return new ShelfScene(canvas, renderer, oak, onReady)
    } catch (error) {
      renderer.dispose()
      throw error
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    renderer: WebGPURenderer,
    private readonly oak: OakMaps,
    private onReady: (() => void) | null,
  ) {
    this.renderer = renderer
    this.woodNodes = 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend === true
    this.scene.scale.setScalar(WORLD_SCALE)
    this.placeholder.colorSpace = THREE.SRGBColorSpace
    this.placeholder.needsUpdate = true
    this.camera.near = WORLD_SCALE
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    const pmrem = new PMREMGenerator(this.renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.environment = this.environment
    this.scene.environmentIntensity = 0.35

    this.light.castShadow = true
    this.light.shadow.mapSize.set(2048, 2048)
    this.light.shadow.radius = 6
    this.light.shadow.bias = -0.0004
    this.light.shadow.normalBias = 0.6 * WORLD_SCALE
    this.scene.add(this.light, this.light.target)

    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.1 }),
    )
    this.wall.position.z = WALL_Z
    this.wall.receiveShadow = true
    this.scene.add(this.wall)

    this.scrim = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: getComputedStyle(canvas).getPropertyValue('--bg').trim(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.scrim.position.z = SCRIM_Z
    this.scrim.visible = false
    this.scene.add(this.scrim)

    this.observer = new IntersectionObserver(this.onIntersect, { rootMargin: '100% 0px' })
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    window.addEventListener('scroll', this.requestRender, { passive: true })
    this.resize()
  }

  /** Shows a sleeve over `element` while it is near the viewport. Returns a function that stops tracking it. */
  trackSleeve(element: HTMLElement, info: SleeveInfo): () => void {
    this.tracked.set(element, info)
    this.observer.observe(element)
    return () => {
      this.observer.unobserve(element)
      this.tracked.delete(element)
      this.deactivate(element)
    }
  }

  /**
   * Draws a crate standing at the bottom of `element`. Sleeves given a place with
   * `arrangeCrate` stand in it instead of over their own elements.
   */
  trackCrate(element: HTMLElement): () => void {
    const model = createCrateModel(this.oak, this.woodNodes)
    const crate: Crate = { element, model, slots: new Map(), count: 0, seconds: FLIP_SECONDS }
    this.crate = crate
    this.scene.add(model.group)
    this.wall.visible = false
    this.requestRender()
    return () => {
      if (this.crate !== crate) return
      this.scene.remove(model.group)
      model.dispose()
      this.crate = null
      this.wall.visible = true
      this.requestRender()
    }
  }

  /**
   * Gives each sleeve element its place in the crate, counted from the front. `direction` says
   * whether the visitor flipped forward (1) or back (-1), so the right record is carried over.
   * A `carried` sleeve is lifted out from wherever it stands and carried over the others. The
   * records then switch to their `restacked` places, if given, as soon as that can't be seen.
   * A flip runs `speed` times as fast as usual.
   */
  arrangeCrate(
    count: number, offsets: Map<HTMLElement, number>, direction: number, carried?: HTMLElement,
    restacked?: Map<HTMLElement, number>, speed = 1,
  ) {
    const crate = this.crate
    if (!crate) return
    crate.count = count
    if (direction) crate.seconds = FLIP_SECONDS / speed
    crate.restack = restacked && { offsets: restacked, carried: carried ?? crate.restack?.carried }
    for (const element of crate.slots.keys()) {
      if (!offsets.has(element)) crate.slots.delete(element)
    }
    for (const [element, offset] of offsets) {
      const slot = crate.slots.get(element)
      if (slot) moveSlot(slot, offset, count, direction, element === carried)
      else crate.slots.set(element, placeSlot(offset, count, element === carried))
    }
    this.requestRender()
  }

  /**
   * Puts each sleeve element straight into its new place in the crate, without moving it there:
   * for reordering the records out of sight behind the front one. Records already headed for
   * their new place, like one being lowered in at the front, carry on.
   */
  restackCrate(count: number, offsets: Map<HTMLElement, number>) {
    const crate = this.crate
    if (!crate) return
    crate.count = count
    crate.restack = undefined
    const slots = new Map<HTMLElement, CrateSlot>()
    for (const [element, offset] of offsets) {
      const slot = crate.slots.get(element)
      slots.set(element, slot?.offset === offset ? slot : placeSlot(offset, count))
    }
    crate.slots = slots
    this.requestRender()
  }

  /**
   * Calls `callback` once the records have switched to the places given to `arrangeCrate`, or
   * once the crate is at rest. Returns a cancel function.
   */
  onCrateRestack(callback: () => void): () => void {
    const crate = this.crate
    if (!crate) return () => {}
    crate.onRestack = callback
    this.requestRender()
    return () => {
      if (crate.onRestack === callback) crate.onRestack = undefined
    }
  }

  /**
   * Calls `callback` once nothing in the crate is moving, as of the next frame drawn: after any
   * arrangement made before then. Returns a cancel function.
   */
  whenCrateSettles(callback: () => void): () => void {
    const crate = this.crate
    if (!crate) return () => {}
    crate.onSettle = callback
    this.requestRender()
    return () => {
      if (crate.onSettle === callback) crate.onSettle = undefined
    }
  }

  /** The id of the crate record under a viewport point, unless the crate itself is in the way. */
  pickCrate(clientX: number, clientY: number): number | null {
    const crate = this.crate
    if (!crate || this.selection || !this.viewportReady) return null
    const bounds = this.canvas.getBoundingClientRect()
    scratch.pointer.set(
      (clientX - bounds.left) / bounds.width * 2 - 1,
      -(clientY - bounds.top) / bounds.height * 2 + 1,
    )
    this.scene.updateMatrixWorld()
    raycaster.setFromCamera(scratch.pointer, this.camera)
    const distance = (object: THREE.Object3D, box: THREE.Box3) => {
      scratch.matrix.copy(object.matrixWorld).invert()
      scratch.ray.copy(raycaster.ray).applyMatrix4(scratch.matrix)
      if (!scratch.ray.intersectBox(box, scratch.hit)) return Infinity
      return scratch.hit.applyMatrix4(object.matrixWorld).distanceTo(raycaster.ray.origin)
    }
    let nearest = Infinity
    let id: number | null = null
    for (const sleeve of this.sleeves.values()) {
      if (!crate.slots.has(sleeve.element) || !sleeve.group.visible) continue
      const hit = distance(sleeve.group, SLEEVE_BOX)
      if (hit < nearest) {
        nearest = hit
        id = sleeve.info.id
      }
    }
    for (const board of crate.model.boards) {
      if (distance(board.mesh, UNIT_BOX) < nearest) return null
    }
    return id
  }

  /** Draws a wooden shelf plank over `element`. */
  trackPlank(element: HTMLElement): () => void {
    // Pick a position once per shelf, so scrolling it out of view never changes its grain.
    if (!this.plankOffsets.has(element)) this.plankOffsets.set(element, Math.random())
    this.tracked.set(element, 'plank')
    this.observer.observe(element)
    return () => {
      this.observer.unobserve(element)
      this.tracked.delete(element)
      this.deactivate(element)
      this.disposePlank(element)
    }
  }

  /** Tips the hovered sleeve's top slightly forward, pivoting on the shelf. */
  hover(id: number | null) {
    this.hovered = id
    this.requestRender()
  }

  /** Brings a sleeve to the front over `stage` and slides its record out. */
  open(id: number, stage: HTMLElement) {
    const sleeve = [...this.sleeves.values()].find((candidate) => candidate.info.id === id)
    if (!sleeve || this.selection) return

    if (this.previewWarmTimer) clearTimeout(this.previewWarmTimer)
    this.previewWarmTimer = null
    const { disc, material, texture } = this.getPreview()
    updateDiscTexture(texture, sleeve.texture?.image ?? null)
    disc.position.set(0, 0.5, 0)
    disc.rotation.z = Math.PI / 2
    disc.visible = false
    sleeve.group.add(disc)

    const selection: Selection = {
      sleeve, stage, disc, material, open: true, travel: 0, slide: 0, speed: 0, angle: 0,
      onClosed: null, artworkAbort: new AbortController(), artwork: null,
    }
    this.selection = selection
    void this.loadSelectedArtwork(selection)
    this.requestRender()
  }

  private getPreview(): Preview {
    if (this.preview) return this.preview
    const { roughness, normal, anisotropy } = getVinylMaps()
    const maxAnisotropy = this.renderer.getMaxAnisotropy()
    const texture = createDiscTexture(null, maxAnisotropy)
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughnessMap: roughness,
      roughness: 1,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.2, 0.2),
      metalness: 0,
      anisotropy: 0.8,
      anisotropyMap: anisotropy,
      clearcoat: 0.24,
      clearcoatRoughness: 0.6,
      clearcoatRoughnessMap: roughness,
    })
    const disc = new THREE.Mesh(this.discGeometry, [this.rimMaterial, material, material])
    disc.position.y = 0.5
    // Compile this detached mesh against the real scene before its first reveal.
    disc.frustumCulled = false
    // Inside the sleeve the record sits just behind the cover, and its shadow-map depth
    // speckles the cover mid-flight. Its shadow would only land behind the backdrop anyway.
    disc.castShadow = false
    return this.preview = { disc, material, texture }
  }

  private warmPreview() {
    this.previewWarmTimer = null
    if (this.disposed || this.selection) return
    const { disc } = this.getPreview()
    // compileAsync builds the small disc's textures/pipeline with yields; it never
    // draws a hidden full-window frame or changes the visible shelf.
    this.previewWarming = this.renderer.compileAsync(disc, this.camera, this.scene).catch(() => {})
  }

  /** Slides the record back in and returns the sleeve to its shelf, then calls `onClosed`. */
  close(onClosed: () => void) {
    if (!this.selection) {
      onClosed()
      return
    }
    this.selection.open = false
    this.selection.artworkAbort.abort()
    this.selection.onClosed = onClosed
    this.requestRender()
  }

  requestRender = () => {
    if (this.disposed) return
    if (!this.frame) this.frame = requestAnimationFrame(this.tick)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.previewWarmTimer) clearTimeout(this.previewWarmTimer)
    this.onReady = null
    cancelAnimationFrame(this.frame)
    window.removeEventListener('scroll', this.requestRender)
    this.observer.disconnect()
    this.resizeObserver.disconnect()
    for (const sleeve of [...this.sleeves.values(), ...this.sleeveCache.values()]) sleeve.abort.abort()
    this.selection?.artworkAbort.abort()
    if (this.previewWarming) void this.previewWarming.then(() => this.disposeResources())
    else this.disposeResources()
  }

  private disposeResources() {
    this.tracked.clear()
    this.clearSelection()
    for (const element of [...this.sleeves.keys(), ...this.planks.keys()]) this.deactivate(element)
    for (const sleeve of this.sleeveCache.values()) this.disposeSleeve(sleeve)
    this.sleeveCache.clear()
    for (const element of this.plankCache.keys()) this.disposePlank(element)
    this.crate?.model.dispose()
    this.crate = null
    this.sleeveGeometry.dispose()
    this.discGeometry.dispose()
    this.placeholder.dispose()
    for (const material of [
      this.edgeMaterial, this.backMaterial, this.rimMaterial,
    ]) {
      material.dispose()
    }
    this.wall.geometry.dispose()
    ;(this.wall.material as THREE.Material).dispose()
    this.scrim.geometry.dispose()
    this.scrim.material.dispose()
    this.environment.dispose()
    this.preview?.texture.dispose()
    this.preview?.material.dispose()
    this.renderer.dispose()
  }

  private onIntersect = (entries: IntersectionObserverEntry[]) => {
    this.layoutObserved = true
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      if (entry.isIntersecting) this.activate(element)
      else this.deactivate(element)
    }
    this.requestRender()
  }

  private activate(element: HTMLElement) {
    const info = this.tracked.get(element)
    if (!info) return
    if (info === 'plank') {
      if (this.planks.has(element)) return
      let cached = this.plankCache.get(element)
      if (!cached) {
        const wood = createWoodMaterial(this.oak, this.woodNodes, this.plankOffsets.get(element)!)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), wood.material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        cached = { mesh, wood }
        this.plankCache.set(element, cached)
      }
      const plank = cached.mesh
      this.planks.set(element, plank)
      this.scene.add(plank)
      return
    }
    const active = this.sleeves.get(element)
    if (active) { active.nearby = true; return }
    const retained = this.sleeveCache.get(element)
    if (retained) {
      this.sleeveCache.delete(element)
      retained.nearby = true
      this.sleeves.set(element, retained)
      this.scene.add(retained.group)
      return
    }

    const paper = getSleevePaperMaps()
    const front = new THREE.MeshStandardMaterial({
      map: this.placeholder,
      color: 0xc9b896,
      roughness: 1,
      roughnessMap: paper.roughness,
      bumpMap: paper.bump,
      bumpScale: 0.3 * WORLD_SCALE,
      envMapIntensity: 0.45,
    })
    const body = new THREE.Mesh(this.sleeveGeometry, [
      this.edgeMaterial,
      this.edgeMaterial,
      this.edgeMaterial,
      this.edgeMaterial,
      front,
      this.backMaterial,
    ])
    body.castShadow = true
    body.receiveShadow = true
    const group = new THREE.Group()
    group.add(body)
    this.scene.add(group)

    const sleeve: Sleeve = {
      info,
      element,
      group,
      front,
      texture: null,
      abort: new AbortController(),
      cover: null,
      nearby: true,
      tilt: 0,
    }
    this.sleeves.set(element, sleeve)
    void this.loadCover(sleeve)
  }

  private async loadCover(sleeve: Sleeve) {
    let image: Blob | null = null
    if (sleeve.info.coverUrl) {
      try {
        image = await loadCoverBlob(sleeve.info.coverUrl, sleeve.abort.signal)
      } catch {
        if (sleeve.abort.signal.aborted) return
      }
    }
    if (sleeve.abort.signal.aborted) {
      return
    }
    sleeve.cover = image
    this.trimSleeveCache()
    if (sleeve.abort.signal.aborted) return
    const texture = await createSleeveTexture(
      image,
      sleeve.info,
      this.renderer.getMaxAnisotropy(),
      SHELF_TEXTURE_SIZE,
    )
    if (sleeve.abort.signal.aborted) {
      texture.dispose()
      return
    }
    sleeve.texture = texture
    sleeve.front.map = this.selection?.sleeve === sleeve && this.selection.artwork
      ? this.selection.artwork : texture
    sleeve.front.color.set(0xffffff)
    sleeve.front.needsUpdate = true
    this.trimSleeveCache()
    if (sleeve.nearby) this.requestRender()
  }

  private async loadSelectedArtwork(selection: Selection) {
    const signal = selection.artworkAbort.signal
    const sleeve = selection.sleeve
    try {
      const cover = sleeve.cover ?? (sleeve.info.coverUrl ? await loadCoverBlob(sleeve.info.coverUrl, signal) : null)
      if (signal.aborted) return
      const artwork = await createSleeveTexture(cover, sleeve.info, this.renderer.getMaxAnisotropy(), SELECTED_TEXTURE_SIZE)
      if (signal.aborted || this.selection !== selection) { artwork.dispose(); return }
      selection.artwork = artwork
      sleeve.front.map = artwork
      sleeve.front.color.set(0xffffff)
      this.requestRender()
    } catch {
      // The cached shelf artwork stays visible if the larger preview cannot load.
    }
  }

  private deactivate(element: HTMLElement) {
    const plank = this.planks.get(element)
    if (plank) {
      this.scene.remove(plank)
      this.planks.delete(element)
    }
    const sleeve = this.sleeves.get(element)
    if (!sleeve) {
      if (!this.tracked.has(element)) {
        const retained = this.sleeveCache.get(element)
        if (retained) this.disposeSleeve(retained)
        this.sleeveCache.delete(element)
      }
      return
    }
    sleeve.nearby = false
    if (this.selection?.sleeve === sleeve) return
    this.scene.remove(sleeve.group)
    this.sleeves.delete(element)
    sleeve.tilt = 0
    if (this.tracked.has(element)) {
      this.sleeveCache.set(element, sleeve)
      this.trimSleeveCache()
    } else this.disposeSleeve(sleeve)
  }

  private disposeSleeve(sleeve: Sleeve) {
    sleeve.abort.abort()
    sleeve.texture?.dispose()
    sleeve.front.dispose()
    sleeve.cover = null
  }

  private trimSleeveCache() {
    // Account for the retained source blob, decoded RGBA bitmap and GPU mip chain.
    const bytes = (sleeve: Sleeve) => {
      const image = sleeve.texture?.image
      return (image ? image.width * image.height : SHELF_TEXTURE_SIZE ** 2) * (4 + 16 / 3)
        + (sleeve.cover?.size ?? 0)
    }
    let used = [...this.sleeveCache.values()].reduce((total, sleeve) => total + bytes(sleeve), 0)
    for (const [element, sleeve] of this.sleeveCache) {
      if (this.sleeveCache.size <= MAX_RETAINED_SLEEVES && used <= RETAINED_ARTWORK_BYTES) break
      used -= bytes(sleeve)
      this.sleeveCache.delete(element)
      this.disposeSleeve(sleeve)
    }
  }

  private disposePlank(element: HTMLElement) {
    const cached = this.plankCache.get(element)
    if (!cached) return
    cached.wood.dispose()
    cached.mesh.geometry.dispose()
    this.plankCache.delete(element)
  }

  private clearSelection() {
    const selection = this.selection
    if (!selection) return
    selection.artworkAbort.abort()
    selection.sleeve.front.map = selection.sleeve.texture ?? this.placeholder
    selection.artwork?.dispose()
    selection.sleeve.group.remove(selection.disc)
    // Keep the disc's shader and texture allocation for the next selected record.
    this.selection = null
    if (!selection.sleeve.nearby || !this.tracked.has(selection.sleeve.element)) this.deactivate(selection.sleeve.element)
  }

  private resize = () => {
    // ResizeObserver runs after animation callbacks, immediately before paint.
    // Clearing the drawing buffer here exposes a blank frame when Safari's
    // toolbar changes height. Resize and draw together in the next tick instead.
    this.requestRender()
  }

  private updateViewport() {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    if (this.viewportReady && width === this.width && height === this.height) return
    this.viewportReady = true
    this.width = width
    this.height = height
    this.renderer.setSize(this.width, this.height, false)
    this.distance = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    this.camera.aspect = this.width / this.height
    this.camera.position.set(0, 0, this.distance * WORLD_SCALE)
    this.camera.far = this.distance * 3 * WORLD_SCALE
    this.camera.updateProjectionMatrix()

    const extent = Math.max(this.width, this.height) * 0.85 * WORLD_SCALE
    const shadowCamera = this.light.shadow.camera
    shadowCamera.left = shadowCamera.bottom = -extent
    shadowCamera.right = shadowCamera.top = extent
    shadowCamera.near = WORLD_SCALE
    shadowCamera.far = this.distance * 3 * WORLD_SCALE
    shadowCamera.updateProjectionMatrix()
    this.light.position.set(-0.3, 0.45, 1).normalize().multiplyScalar(this.distance)

    this.fitToView(this.wall, WALL_Z, 1.4)
    this.fitToView(this.scrim, SCRIM_Z, 1.1)
  }

  private fitToView(mesh: THREE.Mesh, z: number, margin: number) {
    const k = (this.distance - z) / this.distance
    mesh.scale.set(this.width * k * margin, this.height * k * margin, 1)
  }

  /** Where an object at depth `z` must sit to appear over `rect`, anchored at its bottom centre. */
  private rectPose(
    rect: { left: number; bottom: number; width: number },
    z: number,
  ): Pose {
    const k = (this.distance - z) / this.distance
    return {
      x: (rect.left + rect.width / 2 - this.width / 2) * k,
      y: (this.height / 2 - rect.bottom) * k,
      z,
      size: rect.width * k,
      rx: 0,
      ry: 0,
    }
  }

  private tick = (now: number) => {
    this.frame = 0
    this.updateViewport()
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 1 / 20) : 1 / 60
    this.lastTime = now
    const animating = this.update(dt)
    this.renderer.render(this.scene, this.camera)
    // Wait for the observed shelf and all nearby covers (or their fallbacks) to be drawn.
    // Offscreen records remain lazy-loaded as the visitor scrolls.
    if (this.onReady && this.layoutObserved && [...this.sleeves.values()].every((sleeve) => sleeve.texture)) {
      const onReady = this.onReady
      this.onReady = null
      onReady()
      // First show the shelf. Warm only its single detached preview object afterward.
      this.previewWarmTimer = setTimeout(() => this.warmPreview(), 250)
    }
    if (animating) this.requestRender()
    else this.lastTime = 0
  }

  private update(dt: number): boolean {
    let animating = false
    const instant = this.reducedMotion.matches
    const crate = this.crate
    if (crate) animating = this.updateCrate(crate, dt) || animating

    for (const sleeve of this.sleeves.values()) {
      const selected = this.selection?.sleeve === sleeve
      // Hold the clicked pose throughout the selection, including a partial hover tilt.
      // The travel animation blends it into the stage angle after clearing the plank.
      if (!selected) {
        const target = this.hovered === sleeve.info.id && !this.selection ? 1 : 0
        sleeve.tilt = approach(sleeve.tilt, target, instant ? Infinity : 12, dt)
        if (Math.abs(sleeve.tilt - target) > 0.001) animating = true
      }

      const slot = crate?.slots.get(sleeve.element)
      if (crate && !slot && crate.element.contains(sleeve.element)) {
        // Not yet given a place in the crate.
        sleeve.group.visible = false
        continue
      }
      if (crate && slot) {
        const local = crateSleevePose(slot, crate.count, sleeve.tilt, sleeve.info.id)
        if (selected && this.selection) {
          animating = this.updateSelection(this.selection, this.rectPose(sleeve.element.getBoundingClientRect(), 0), dt, { crate, local }) || animating
        } else {
          sleeve.group.visible = local.visible
          this.applyCratePose(sleeve.group, crate, local)
        }
        continue
      }

      const pose = this.rectPose(sleeve.element.getBoundingClientRect(), 0)
      pose.rx = LEAN + sleeve.tilt * HOVER_TILT
      if (selected && this.selection) {
        animating = this.updateSelection(this.selection, pose, dt) || animating
      } else {
        this.applyPose(sleeve.group, pose)
      }
    }

    for (const [element, plank] of this.planks) {
      const rect = element.getBoundingClientRect()
      plank.position.set(
        rect.left + rect.width / 2 - this.width / 2,
        this.height / 2 - (rect.top + rect.height / 2),
        PLANK_FRONT - PLANK_DEPTH / 2,
      )
      plank.scale.set(rect.width, rect.height, PLANK_DEPTH)
      if (plank.userData.width !== rect.width || plank.userData.height !== rect.height) {
        plank.geometry.dispose()
        plank.geometry = createPlankGeometry(
          rect.width, rect.height, PLANK_DEPTH, this.plankCache.get(element)?.wood.grain,
        )
        plank.userData.width = rect.width
        plank.userData.height = rect.height
      }
      this.plankCache.get(element)?.wood.setDimensions(rect.width, rect.height, PLANK_DEPTH)
    }

    if (!this.selection) this.scrim.visible = false
    return animating
  }

  private updateSelection(
    selection: Selection,
    shelfPose: Pose,
    dt: number,
    fromCrate?: { crate: Crate; local: CratePose },
  ): boolean {
    const instant = this.reducedMotion.matches
    const travelStep = instant ? 1 : dt / (fromCrate ? CRATE_TRAVEL_SECONDS : TRAVEL_SECONDS)
    const slideStep = instant ? 1 : dt / SLIDE_SECONDS

    if (selection.open) {
      selection.travel = step(selection.travel, 1, travelStep)
      if (selection.travel >= 1) selection.slide = step(selection.slide, 1, slideStep)
    } else {
      selection.slide = step(selection.slide, 0, slideStep * 1.4)
      if (selection.slide <= 0) selection.travel = step(selection.travel, 0, travelStep)
    }
    const spinning = selection.open && selection.slide >= 1 && !instant
    selection.speed = approach(selection.speed, spinning ? SPIN_SPEED : 0, spinning ? 1.2 : 8, dt)
    selection.angle += selection.speed * dt

    const stage = selection.stage.getBoundingClientRect()
    const front = this.rectPose(
      { left: stage.left, bottom: stage.bottom, width: stage.height },
      FRONT_Z,
    )
    front.rx = 0
    front.ry = -0.05

    let t = easeInOut(selection.travel)
    if (fromCrate) {
      this.applyCrateSelection(selection, fromCrate.crate, fromCrate.local, front)
      const z = selection.sleeve.group.position.z
      t = THREE.MathUtils.clamp((z - CRATE_SCRIM_START) / (FRONT_Z - CRATE_SCRIM_START), 0, 1)
    } else {
      // Pull straight off the plank before moving toward the stage. Reversing this
      // path aligns the sleeve with its slot before pushing it back onto the shelf.
      const pull = easeInOut(Math.min(selection.travel / SHELF_CLEARANCE_FRACTION, 1))
      const move = easeInOut(Math.max(
        (selection.travel - SHELF_CLEARANCE_FRACTION) / (1 - SHELF_CLEARANCE_FRACTION),
        0,
      ))
      const arc = Math.sin(Math.PI * move)
      this.applyPose(selection.sleeve.group, {
        x: THREE.MathUtils.lerp(shelfPose.x, front.x, move),
        y: THREE.MathUtils.lerp(shelfPose.y, front.y, move),
        z: THREE.MathUtils.lerp(shelfPose.z, front.z, pull) + arc * 80,
        size: THREE.MathUtils.lerp(shelfPose.size, front.size, move),
        rx: THREE.MathUtils.lerp(shelfPose.rx, front.rx, move),
        ry: THREE.MathUtils.lerp(shelfPose.ry, front.ry, move) + arc * 0.45,
      })
    }

    selection.disc.position.x = SLIDE_DISTANCE * easeInOut(selection.slide)
    // The first/last part of the slide is still entirely inside the sleeve. Keep the
    // disc out of the depth buffer until its edge actually clears the cover.
    selection.disc.visible = selection.disc.position.x + RECORD_RADIUS > 0.5
    // The cylinder cap's UVs are a quarter turn off, so start a quarter turn back to keep the label upright.
    selection.disc.rotation.z = Math.PI / 2 - selection.angle

    this.scrim.visible = t > 0
    this.scrim.material.opacity = SCRIM_OPACITY * t

    if (!selection.open && selection.travel <= 0) {
      const onClosed = selection.onClosed
      this.clearSelection()
      onClosed?.()
      return true
    }
    return selection.travel < 1 || selection.slide < 1 || selection.speed > 0.001 || spinning
  }

  private applyPose(group: THREE.Group, pose: Pose) {
    group.position.set(pose.x, pose.y, pose.z)
    group.scale.setScalar(pose.size)
    group.rotation.set(pose.rx, pose.ry, 0)
  }

  private updateCrate(crate: Crate, dt: number): boolean {
    const fit = fitCrate(crate.element.getBoundingClientRect(), this.viewport())
    const group = crate.model.group
    group.matrix.compose(fit.position, CRATE_ROTATION, scratch.scale.setScalar(fit.scale))
    group.matrixWorldNeedsUpdate = true
    crate.model.update(fit.scale, this.scrim.visible ? this.scrim.material.opacity / SCRIM_OPACITY : 0)
    // Hold the crate still while a record from it is open.
    if (this.selection && crate.slots.has(this.selection.sleeve.element)) return false
    const moving = settleSlots(crate.slots.values(), crate.count, dt, this.reducedMotion.matches, crate.seconds)
    // Switching places before this frame is drawn, there is never a frame in which the records
    // behind the front one could be seen changing.
    const pulled = crate.restack?.carried && crate.slots.get(crate.restack.carried)
    if (!moving || (pulled && hidesStack(pulled, crate.count))) {
      if (crate.restack) this.restackCrate(crate.count, crate.restack.offsets)
      const onRestack = crate.onRestack
      crate.onRestack = undefined
      onRestack?.()
    }
    if (!moving && crate.onSettle) {
      const onSettle = crate.onSettle
      crate.onSettle = undefined
      onSettle()
    }
    return moving
  }

  private viewport() {
    return { width: this.width, height: this.height, distance: this.distance }
  }

  /** Sets a sleeve's transform from a pose in the crate's own space. */
  private applyCratePose(group: THREE.Group, crate: Crate, pose: CratePose) {
    scratch.local.compose(
      scratch.position.set(pose.x, pose.y, pose.z),
      scratch.quaternion.setFromEuler(scratch.euler.set(pose.rx, 0, pose.rz)),
      scratch.one,
    )
    scratch.matrix.multiplyMatrices(crate.model.group.matrix, scratch.local)
    scratch.matrix.decompose(group.position, group.quaternion, group.scale)
  }

  /** Lifts the record straight out of the crate, clear of its neighbours, then carries it to the stage. */
  private applyCrateSelection(selection: Selection, crate: Crate, local: CratePose, front: Pose) {
    const group = selection.sleeve.group
    const pull = pickUp(Math.min(selection.travel / CRATE_LIFT_FRACTION, 1))
    const move = easeInOut(Math.max((selection.travel - CRATE_MOVE_START) / (1 - CRATE_MOVE_START), 0))
    this.applyCratePose(group, crate, raisePose(local, pull * CRATE_LIFT))
    group.visible = true
    if (move <= 0) return

    const arc = Math.sin(Math.PI * move)
    const fromPosition = scratch.hit.copy(group.position)
    const fromQuaternion = scratch.quaternion.copy(group.quaternion)
    const fromSize = group.scale.x
    group.position.lerpVectors(fromPosition, scratch.position.set(front.x, front.y, front.z), move)
    group.position.z += arc * 80
    group.quaternion.slerpQuaternions(
      fromQuaternion,
      new THREE.Quaternion().setFromEuler(scratch.euler.set(front.rx, front.ry, 0)),
      move,
    ).premultiply(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, arc * 0.3))
    group.scale.setScalar(THREE.MathUtils.lerp(fromSize, front.size, move))
  }
}
