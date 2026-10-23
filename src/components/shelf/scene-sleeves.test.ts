import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'
import { createSleeveTexture, loadCoverBlob } from './textures'

vi.mock('./textures', () => ({
  getSleevePaperMaps: () => ({ roughness: new THREE.Texture(), bump: new THREE.Texture() }),
  loadCoverBlob: vi.fn(), createSleeveTexture: vi.fn(),
}))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

type TestSleeve = {
  group: THREE.Group; texture: THREE.Texture | null; front: THREE.MeshStandardMaterial; abort: AbortController
}
type TestSelection = { sleeve: TestSleeve; disc: THREE.Mesh; material: THREE.MeshPhysicalMaterial;
  artworkAbort: AbortController; artwork: THREE.Texture | null }
function shelf() {
  const renderer = { getMaxAnisotropy: () => 4, dispose: vi.fn() }
  const scene = Object.assign(Object.create(ShelfScene.prototype), {
    scene: new THREE.Scene(), tracked: new Map(), sleeves: new Map(), sleeveCache: new Map(),
    planks: new Map(), plankCache: new Map(), sleeveGeometry: new THREE.BufferGeometry(),
    edgeMaterial: new THREE.MeshStandardMaterial(), backMaterial: new THREE.MeshStandardMaterial(),
    rimMaterial: new THREE.MeshStandardMaterial(), discGeometry: new THREE.BufferGeometry(),
    wall: new THREE.Mesh(), scrim: new THREE.Mesh(), environment: new THREE.Texture(),
    placeholder: new THREE.DataTexture(), renderer,
    observer: { observe() {}, unobserve() {}, disconnect() {} }, resizeObserver: { disconnect() {} }, requestRender: vi.fn(),
  }) as {
    trackSleeve: (element: HTMLElement, info: object) => () => void
    activate: (element: HTMLElement) => void
    deactivate: (element: HTMLElement) => void
    clearSelection: () => void
    dispose: () => void
    loadSelectedArtwork: (selection: TestSelection) => Promise<void>
    sleeves: Map<HTMLElement, TestSleeve>
    sleeveCache: Map<HTMLElement, TestSleeve>
    selection: TestSelection | null
    scene: THREE.Scene
  }
  vi.mocked(loadCoverBlob).mockResolvedValue(new Blob())
  vi.mocked(createSleeveTexture).mockImplementation(async () => new THREE.CanvasTexture({ width: 512, height: 512 } as ImageBitmap))
  function add(id: number) {
    const element = {} as HTMLElement
    const untrack = scene.trackSleeve(element, { id, artist: 'Artist', title: 'Album', coverUrl: 'cover.jpg' })
    scene.activate(element)
    return { element, untrack, sleeve: scene.sleeves.get(element)! }
  }
  return { scene, add, renderer }
}
async function loaded(sleeve: TestSleeve) { await vi.waitFor(() => expect(sleeve.texture).not.toBeNull()) }

describe('sleeve resource cache', () => {
  it('reuses artwork and materials on return without drawing retained sleeves', async () => {
    const { scene, add } = shelf()
    const { element, sleeve } = add(1)
    await loaded(sleeve)
    const dispose = vi.spyOn(sleeve.texture!, 'dispose')
    scene.deactivate(element)
    expect(scene.scene.children).not.toContain(sleeve.group)
    expect(scene.sleeves.size).toBe(0)
    expect(dispose).not.toHaveBeenCalled()
    expect(sleeve.abort.signal.aborted).toBe(false)
    scene.activate(element)
    expect(scene.sleeves.get(element)).toBe(sleeve)
    expect(scene.scene.children).toContain(sleeve.group)
    expect(loadCoverBlob).toHaveBeenCalledTimes(1)
    expect(createSleeveTexture).toHaveBeenCalledTimes(1)
    expect(createSleeveTexture).toHaveBeenCalledWith(expect.any(Blob), expect.any(Object), 4, 512)
  })

  it('evicts the least recently used inactive sleeve after the count budget is reached', async () => {
    const { scene, add } = shelf()
    const first = add(1)
    await loaded(first.sleeve)
    const dispose = vi.spyOn(first.sleeve.texture!, 'dispose')
    scene.deactivate(first.element)
    for (let id = 2; id <= 25; id++) {
      const entry = add(id)
      await loaded(entry.sleeve)
      scene.deactivate(entry.element)
    }
    expect(scene.sleeveCache.size).toBe(24)
    expect(first.sleeve.abort.signal.aborted).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    scene.activate(first.element)
    expect(scene.sleeves.get(first.element)).not.toBe(first.sleeve)
  })

  it('disposes a retained sleeve exactly once when its slot unmounts', async () => {
    const { scene, add } = shelf()
    const { element, sleeve, untrack } = add(1)
    await loaded(sleeve)
    const dispose = vi.spyOn(sleeve.texture!, 'dispose')
    const materialDispose = vi.spyOn(sleeve.front, 'dispose')
    scene.deactivate(element)
    untrack()
    untrack()
    expect(scene.sleeveCache.size).toBe(0)
    expect(dispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('enforces the byte budget even before reaching the count limit', async () => {
    const { scene, add } = shelf()
    const largeSource = new Blob()
    Object.defineProperty(largeSource, 'size', { value: 40 * 1024 * 1024 })
    vi.mocked(loadCoverBlob).mockResolvedValue(largeSource)
    const first = add(1)
    await loaded(first.sleeve)
    scene.deactivate(first.element)
    const second = add(2)
    await loaded(second.sleeve)
    scene.deactivate(second.element)
    expect(scene.sleeveCache.size).toBe(1)
    expect(first.sleeve.abort.signal.aborted).toBe(true)
    expect(second.sleeve.abort.signal.aborted).toBe(false)
  })

  it('budgets compressed sources as they arrive, without waiting for worker painting', async () => {
    const { scene, add } = shelf()
    const source = new Blob()
    Object.defineProperty(source, 'size', { value: 40 * 1024 * 1024 })
    const downloads: ((value: Blob) => void)[] = []
    const paintings: ((value: THREE.CanvasTexture<ImageBitmap>) => void)[] = []
    vi.mocked(loadCoverBlob).mockImplementation(() => new Promise((resolve) => { downloads.push(resolve) }))
    vi.mocked(createSleeveTexture).mockImplementation(() => new Promise((resolve) => { paintings.push(resolve) }))
    const first = add(1), second = add(2)
    scene.deactivate(first.element)
    scene.deactivate(second.element)
    downloads.forEach((finish) => finish(source))
    await vi.waitFor(() => expect(paintings).toHaveLength(2))
    expect(scene.sleeveCache.size).toBe(1)
    expect(first.sleeve.abort.signal.aborted).toBe(true)
    expect(second.sleeve.abort.signal.aborted).toBe(false)
    const outputs = paintings.map(() => new THREE.CanvasTexture({ width: 512, height: 512 } as ImageBitmap))
    const dispose = vi.spyOn(outputs[0]!, 'dispose')
    paintings.forEach((finish, index) => finish(outputs[index]!))
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  })

  it('releases active and retained artwork when the scene is disposed', async () => {
    vi.stubGlobal('window', { removeEventListener() {} })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { scene, add } = shelf()
    const first = add(1)
    const second = add(2)
    await loaded(first.sleeve)
    await loaded(second.sleeve)
    const firstDispose = vi.spyOn(first.sleeve.texture!, 'dispose')
    const secondDispose = vi.spyOn(second.sleeve.texture!, 'dispose')
    scene.deactivate(first.element)
    scene.dispose()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
    expect(scene.sleeves.size).toBe(0)
    expect(scene.sleeveCache.size).toBe(0)
  })

  it('finishes pending preview compilation before disposing its renderer and persistent resources', async () => {
    vi.stubGlobal('window', { removeEventListener() {} })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { scene, renderer, add } = shelf()
    const entry = add(1)
    await loaded(entry.sleeve)
    let finish!: () => void
    const warming = new Promise<void>((resolve) => { finish = resolve })
    const texture = new THREE.CanvasTexture()
    const material = new THREE.MeshPhysicalMaterial({ map: texture })
    const textureDispose = vi.spyOn(texture, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    const geometry = new THREE.BufferGeometry()
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const rim = new THREE.MeshStandardMaterial()
    const rimDispose = vi.spyOn(rim, 'dispose')
    const environment = new THREE.Texture()
    const environmentDispose = vi.spyOn(environment, 'dispose')
    Object.assign(scene, { previewWarming: warming, preview: { texture, material },
      discGeometry: geometry, rimMaterial: rim, environment })
    scene.dispose()
    expect(renderer.dispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(rimDispose).not.toHaveBeenCalled()
    expect(environmentDispose).not.toHaveBeenCalled()
    expect(entry.sleeve.abort.signal.aborted).toBe(true)
    finish()
    await warming
    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(textureDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(rimDispose).toHaveBeenCalledOnce()
    expect(environmentDispose).toHaveBeenCalledOnce()
  })

  it('keeps an in-flight cover across a visibility exit, but discards output after unmount', async () => {
    const { scene, add } = shelf()
    let finish!: (value: THREE.CanvasTexture<ImageBitmap>) => void
    vi.mocked(createSleeveTexture).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { element, sleeve, untrack } = add(1)
    await vi.waitFor(() => expect(createSleeveTexture).toHaveBeenCalled())
    scene.deactivate(element)
    expect(sleeve.abort.signal.aborted).toBe(false)
    untrack()
    const output = new THREE.CanvasTexture({ width: 512, height: 512 } as ImageBitmap)
    const dispose = vi.spyOn(output, 'dispose')
    finish(output)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(sleeve.texture).toBeNull()
  })

  it('pins a selected sleeve until the selection closes, even if its slot unmounts', async () => {
    const { scene, add } = shelf()
    const { sleeve, untrack } = add(1)
    await loaded(sleeve)
    const dispose = vi.spyOn(sleeve.texture!, 'dispose')
    scene.selection = { sleeve, disc: new THREE.Mesh(), material: new THREE.MeshPhysicalMaterial(),
      artworkAbort: new AbortController(), artwork: null }
    untrack()
    expect(dispose).not.toHaveBeenCalled()
    scene.clearSelection()
    expect(dispose).toHaveBeenCalledOnce()
    expect(scene.sleeves.size).toBe(0)
    expect(scene.sleeveCache.size).toBe(0)
  })

  it('discards a delayed selected-cover upgrade after close without replacing cached shelf artwork', async () => {
    const { scene, add } = shelf()
    const { sleeve } = add(1)
    await loaded(sleeve)
    const shelfArtwork = sleeve.texture
    let finish!: (value: THREE.CanvasTexture<ImageBitmap>) => void
    vi.mocked(createSleeveTexture).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const selection: TestSelection = { sleeve, disc: new THREE.Mesh(), material: new THREE.MeshPhysicalMaterial(),
      artworkAbort: new AbortController(), artwork: null }
    scene.selection = selection
    const upgrading = scene.loadSelectedArtwork(selection)
    expect(createSleeveTexture).toHaveBeenLastCalledWith(expect.any(Blob), expect.any(Object), 4, 1024)
    scene.clearSelection()
    const output = new THREE.CanvasTexture({ width: 1024, height: 1024 } as ImageBitmap)
    const dispose = vi.spyOn(output, 'dispose')
    finish(output)
    await upgrading
    expect(dispose).toHaveBeenCalledOnce()
    expect(sleeve.texture).toBe(shelfArtwork)
    expect(sleeve.front.map).toBe(shelfArtwork)
  })
})
