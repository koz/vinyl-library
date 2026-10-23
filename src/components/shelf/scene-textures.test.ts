import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'
import { createSleeveTexture, loadCoverBlob } from './textures'

vi.mock('./textures', () => ({
  createSleeveTexture: vi.fn(), loadCoverBlob: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

function loadingSleeve() {
  const sleeve = {
    info: { id: 1, artist: 'Artist', title: 'Album', coverUrl: 'cover.jpg' },
    abort: new AbortController(), front: new THREE.MeshStandardMaterial(), texture: null,
    nearby: true, cover: null,
  }
  const scene = Object.assign(Object.create(ShelfScene.prototype), {
    renderer: { getMaxAnisotropy: () => 4 }, requestRender: vi.fn(),
    sleeveCache: new Map(),
  }) as { loadCover: (sleeve: object) => Promise<void>; requestRender: ReturnType<typeof vi.fn> }
  const image = new Blob()
  vi.mocked(loadCoverBlob).mockResolvedValue(image)
  let finish!: (texture: THREE.CanvasTexture<ImageBitmap>) => void
  vi.mocked(createSleeveTexture).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const texture = new THREE.CanvasTexture<ImageBitmap>()
  const dispose = vi.spyOn(texture, 'dispose')
  return { scene, sleeve, image, texture, dispose, finish: () => finish(texture) }
}

describe('asynchronous sleeve painting lifecycle', () => {
  it('disposes worker output when a sleeve leaves view while being painted', async () => {
    const { scene, sleeve, texture, dispose, finish } = loadingSleeve()
    const loading = scene.loadCover(sleeve)
    await vi.waitFor(() => expect(createSleeveTexture).toHaveBeenCalled())
    sleeve.abort.abort()
    finish()
    await loading
    expect(dispose).toHaveBeenCalledOnce()
    expect(sleeve.texture).toBeNull()
    expect(sleeve.front.map).not.toBe(texture)
    expect(scene.requestRender).not.toHaveBeenCalled()
  })

  it('attaches completed artwork and requests a frame while the sleeve is still visible', async () => {
    const { scene, sleeve, texture, finish } = loadingSleeve()
    const loading = scene.loadCover(sleeve)
    await vi.waitFor(() => expect(createSleeveTexture).toHaveBeenCalled())
    finish()
    await loading
    expect(sleeve.texture).toBe(texture)
    expect(sleeve.front.map).toBe(texture)
    expect(scene.requestRender).toHaveBeenCalledOnce()
  })

  it('keeps a selected high-resolution cover when the smaller shelf artwork finishes later', async () => {
    const { scene, sleeve, texture, finish } = loadingSleeve()
    const artwork = new THREE.CanvasTexture<ImageBitmap>()
    Object.assign(scene, { selection: { sleeve, artwork } })
    const loading = scene.loadCover(sleeve)
    await vi.waitFor(() => expect(createSleeveTexture).toHaveBeenCalled())
    finish()
    await loading
    expect(sleeve.texture).toBe(texture)
    expect(sleeve.front.map).toBe(artwork)
  })
})
