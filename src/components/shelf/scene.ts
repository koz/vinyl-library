import * as THREE from 'three'
import { WebGPURenderer, PMREMGenerator } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EXPOSED, RECORD_RADIUS } from './layout'
import { createPlankGeometry, createSleeveGeometry } from './geometry'
import { createWoodMaterial } from './wood-material'
import {
  createDiscTexture,
  createSleeveTexture,
  getVinylMaps,
  getSleevePaperMaps,
  loadOakMaps,
  type OakMaps,
  loadCoverImage,
} from './textures'

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
const TRAVEL_SECONDS = 0.75
const SHELF_CLEARANCE_FRACTION = 0.3
const SLIDE_SECONDS = 0.9
const SCRIM_OPACITY = 0.94
const BACKGROUND = 0xf5f2ec
// The wood shader's distance filtering is designed for metre-scale scenes.
const WORLD_SCALE = 0.001

type Pose = { x: number; y: number; z: number; size: number; rx: number; ry: number }

type Sleeve = {
  info: SleeveInfo
  element: HTMLElement
  group: THREE.Group
  front: THREE.MeshStandardMaterial
  texture: THREE.CanvasTexture | null
  abort: AbortController
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
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
const step = (current: number, target: number, delta: number) =>
  target > current ? Math.min(target, current + delta) : Math.max(target, current - delta)

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
  private readonly planks = new Map<HTMLElement, THREE.Mesh>()
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private hovered: number | null = null
  private selection: Selection | null = null
  private width = 1
  private height = 1
  private distance = 1
  private frame = 0
  private lastTime = 0
  private layoutObserved = false

  static async create(canvas: HTMLCanvasElement, onReady: () => void = () => {}): Promise<ShelfScene> {
    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: true })
    try {
      await renderer.init()
      const oak = await loadOakMaps(renderer.getMaxAnisotropy())
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
        color: BACKGROUND,
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

    const { roughness, normal, anisotropy } = getVinylMaps()
    const maxAnisotropy = this.renderer.getMaxAnisotropy()
    const material = new THREE.MeshPhysicalMaterial({
      map: createDiscTexture(sleeve.texture?.image ?? null, maxAnisotropy),
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
    disc.visible = false
    // Inside the sleeve the record sits just behind the cover, and its shadow-map depth
    // speckles the cover mid-flight. Its shadow would only land behind the backdrop anyway.
    disc.castShadow = false
    sleeve.group.add(disc)

    this.selection = {
      sleeve,
      stage,
      disc,
      material,
      open: true,
      travel: 0,
      slide: 0,
      speed: 0,
      angle: 0,
      onClosed: null,
    }
    this.requestRender()
  }

  /** Slides the record back in and returns the sleeve to its shelf, then calls `onClosed`. */
  close(onClosed: () => void) {
    if (!this.selection) {
      onClosed()
      return
    }
    this.selection.open = false
    this.selection.onClosed = onClosed
    this.requestRender()
  }

  requestRender = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick)
  }

  dispose() {
    this.onReady = null
    cancelAnimationFrame(this.frame)
    window.removeEventListener('scroll', this.requestRender)
    this.observer.disconnect()
    this.resizeObserver.disconnect()
    this.clearSelection()
    for (const element of [...this.sleeves.keys(), ...this.planks.keys()]) this.deactivate(element)
    for (const element of this.plankCache.keys()) this.disposePlank(element)
    this.sleeveGeometry.dispose()
    this.discGeometry.dispose()
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
    if (this.sleeves.has(element)) return

    const paper = getSleevePaperMaps()
    const front = new THREE.MeshStandardMaterial({
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
      tilt: 0,
    }
    this.sleeves.set(element, sleeve)
    void this.loadCover(sleeve)
  }

  private async loadCover(sleeve: Sleeve) {
    let image: ImageBitmap | null = null
    if (sleeve.info.coverUrl) {
      try {
        image = await loadCoverImage(sleeve.info.coverUrl, sleeve.abort.signal)
      } catch {
        if (sleeve.abort.signal.aborted) return
      }
    }
    if (sleeve.abort.signal.aborted) {
      image?.close()
      return
    }
    sleeve.texture = createSleeveTexture(
      image,
      sleeve.info,
      this.renderer.getMaxAnisotropy(),
    )
    image?.close()
    sleeve.front.map = sleeve.texture
    sleeve.front.color.set(0xffffff)
    sleeve.front.needsUpdate = true
    this.requestRender()
  }

  private deactivate(element: HTMLElement) {
    const plank = this.planks.get(element)
    if (plank) {
      this.scene.remove(plank)
      this.planks.delete(element)
    }
    const sleeve = this.sleeves.get(element)
    if (!sleeve || this.selection?.sleeve === sleeve) return
    sleeve.abort.abort()
    sleeve.texture?.dispose()
    sleeve.front.dispose()
    this.scene.remove(sleeve.group)
    this.sleeves.delete(element)
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
    selection.sleeve.group.remove(selection.disc)
    selection.material.map?.dispose()
    selection.material.dispose()
    this.selection = null
    if (!this.tracked.has(selection.sleeve.element)) this.deactivate(selection.sleeve.element)
  }

  private resize = () => {
    this.width = this.canvas.clientWidth || 1
    this.height = this.canvas.clientHeight || 1
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
    this.requestRender()
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
    }
    if (animating) this.requestRender()
    else this.lastTime = 0
  }

  private update(dt: number): boolean {
    let animating = false
    const instant = this.reducedMotion.matches

    for (const sleeve of this.sleeves.values()) {
      const selected = this.selection?.sleeve === sleeve
      // Hold the clicked pose throughout the selection, including a partial hover tilt.
      // The travel animation blends it into the stage angle after clearing the plank.
      if (!selected) {
        const target = this.hovered === sleeve.info.id && !this.selection ? 1 : 0
        sleeve.tilt = approach(sleeve.tilt, target, instant ? Infinity : 12, dt)
        if (Math.abs(sleeve.tilt - target) > 0.001) animating = true
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
        plank.geometry = createPlankGeometry(rect.width, rect.height, PLANK_DEPTH)
        plank.userData.width = rect.width
        plank.userData.height = rect.height
      }
      this.plankCache.get(element)?.wood.setDimensions(rect.width, rect.height, PLANK_DEPTH)
    }

    if (!this.selection) this.scrim.visible = false
    return animating
  }

  private updateSelection(selection: Selection, shelfPose: Pose, dt: number): boolean {
    const instant = this.reducedMotion.matches
    const travelStep = instant ? 1 : dt / TRAVEL_SECONDS
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

    const t = easeInOut(selection.travel)
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
}
