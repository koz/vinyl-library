import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ShelfScene } from './scene'
import { createDiscTexture, updateDiscTexture } from './textures'

vi.mock('./textures', () => ({
  getVinylMaps: () => ({ roughness: new THREE.Texture(), normal: new THREE.Texture(), anisotropy: new THREE.Texture() }),
  createDiscTexture: vi.fn(() => new THREE.CanvasTexture()), updateDiscTexture: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

function preview() {
  const camera = new THREE.PerspectiveCamera()
  const scene = new THREE.Scene()
  const material = new THREE.MeshStandardMaterial()
  const sleeves = [1, 2].map((id) => ({ info: { id }, group: new THREE.Group(),
    texture: new THREE.CanvasTexture(), front: material, nearby: true, element: {} }))
  const renderer = { getMaxAnisotropy: () => 4, compileAsync: vi.fn(async () => {}), render: vi.fn() }
  const shelf = Object.assign(Object.create(ShelfScene.prototype), {
    sleeves: new Map(sleeves.map((sleeve) => [sleeve.element, sleeve])), selection: null,
    renderer, scene, camera, discGeometry: new THREE.BufferGeometry(), rimMaterial: new THREE.MeshStandardMaterial(),
    preview: null, requestRender: vi.fn(), loadSelectedArtwork: vi.fn(async () => {}),
    tracked: new Map(sleeves.map((sleeve) => [sleeve.element, sleeve.info])),
  }) as { open: (id: number, stage: HTMLElement) => void; clearSelection: () => void;
    warmPreview: () => void; previewWarming: Promise<void> | null; disposed: boolean;
    selection: { disc: THREE.Mesh; material: THREE.MeshPhysicalMaterial }; preview: { disc: THREE.Mesh } }
  return { shelf, sleeves, renderer, camera, scene }
}

describe('reusable record preview', () => {
  it('keeps the compiled disc, material and texture between selections while repainting each label', () => {
    const { shelf, sleeves } = preview()
    shelf.open(1, {} as HTMLElement)
    const { disc, material } = shelf.selection
    const dispose = vi.spyOn(material, 'dispose')
    const mapDispose = vi.spyOn(material.map!, 'dispose')
    expect(updateDiscTexture).toHaveBeenLastCalledWith(material.map, sleeves[0]!.texture.image)
    shelf.clearSelection()
    expect(dispose).not.toHaveBeenCalled()
    expect(mapDispose).not.toHaveBeenCalled()
    expect(disc.parent).toBeNull()
    shelf.open(2, {} as HTMLElement)
    expect(shelf.selection.disc).toBe(disc)
    expect(shelf.selection.material).toBe(material)
    expect(createDiscTexture).toHaveBeenCalledOnce()
    expect(updateDiscTexture).toHaveBeenLastCalledWith(material.map, sleeves[1]!.texture.image)
  })

  it('precompiles only the detached preview against the actual scene without rendering a frame', async () => {
    const { shelf, renderer, camera, scene } = preview()
    shelf.warmPreview()
    await shelf.previewWarming
    expect(renderer.compileAsync).toHaveBeenCalledWith(shelf.preview.disc, camera, scene)
    expect(shelf.preview.disc.parent).toBeNull()
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('does not start precompilation after disposal or while a record is open', () => {
    const { shelf, renderer } = preview()
    shelf.disposed = true
    shelf.warmPreview()
    expect(renderer.compileAsync).not.toHaveBeenCalled()
    shelf.disposed = false
    shelf.open(1, {} as HTMLElement)
    shelf.warmPreview()
    expect(renderer.compileAsync).not.toHaveBeenCalled()
  })
})
