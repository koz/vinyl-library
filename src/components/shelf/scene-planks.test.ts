import { afterEach, describe, expect, it, vi } from 'vitest'

import * as THREE from 'three'
import { ShelfScene } from './scene'

afterEach(() => vi.unstubAllGlobals())

function planks(nodes: boolean) {
  // Exercise the real visibility/unmount lifecycle without starting a GPU renderer.
  const scene = Object.assign(Object.create(ShelfScene.prototype), {
    woodNodes: nodes,
    oak: {
      color: new THREE.CanvasTexture(), bump: new THREE.CanvasTexture(),
      roughness: new THREE.CanvasTexture(), endGrain: new THREE.CanvasTexture(),
    },
    scene: new THREE.Scene(),
    tracked: new Map(),
    planks: new Map(),
    sleeves: new Map(),
    plankOffsets: new WeakMap(),
    plankCache: new Map(),
    observer: { observe() {}, unobserve() {}, disconnect() {} },
    resizeObserver: { disconnect() {} },
    sleeveGeometry: new THREE.BufferGeometry(),
    discGeometry: new THREE.BufferGeometry(),
    edgeMaterial: new THREE.MeshStandardMaterial(),
    backMaterial: new THREE.MeshStandardMaterial(),
    rimMaterial: new THREE.MeshStandardMaterial(),
    wall: new THREE.Mesh(),
    scrim: new THREE.Mesh(),
    environment: new THREE.Texture(),
    renderer: { dispose() {} },
  }) as {
    dispose: () => void
    trackPlank: (element: HTMLElement) => () => void
    activate: (element: HTMLElement) => void
    deactivate: (element: HTMLElement) => void
    scene: THREE.Scene
    planks: Map<HTMLElement, THREE.Mesh>
  }
  const element = {} as HTMLElement
  const untrack = scene.trackPlank(element)
  scene.activate(element)
  return { scene, element, untrack, mesh: scene.planks.get(element)! }
}

for (const nodes of [true, false]) {
  describe(`plank visibility lifecycle (${nodes ? 'WebGPU' : 'WebGL'})`, () => {
    it('retains compiled materials and geometry when leaving and returning to the viewport', () => {
      const { scene, element, mesh, untrack } = planks(nodes)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      let disposals = 0
      for (const material of new Set(materials)) {
        material.addEventListener('dispose', () => { disposals++ })
      }
      mesh.geometry.addEventListener('dispose', () => { disposals++ })
      for (let i = 0; i < 3; i++) {
        scene.deactivate(element)
        expect(scene.scene.children).not.toContain(mesh)
        expect(scene.planks.has(element)).toBe(false)
        expect(disposals).toBe(0)
        scene.activate(element)
        expect(scene.planks.get(element)).toBe(mesh)
        expect(scene.scene.children).toContain(mesh)
      }
      untrack()
      expect(disposals).toBeGreaterThan(0)
      expect(scene.planks.has(element)).toBe(false)
      expect(scene.scene.children).not.toContain(mesh)
    })

    it('releases both active and retained planks when the scene closes', () => {
      vi.stubGlobal('window', { removeEventListener() {} })
      vi.stubGlobal('cancelAnimationFrame', () => {})
      const { scene, element, mesh } = planks(nodes)
      scene.deactivate(element)
      const otherElement = {} as HTMLElement
      scene.trackPlank(otherElement)
      scene.activate(otherElement)
      let materialDisposals = 0
      let geometryDisposals = 0
      for (const plank of [mesh, scene.planks.get(otherElement)!]) {
        const material = Array.isArray(plank.material) ? plank.material[2]! : plank.material
        material.addEventListener('dispose', () => { materialDisposals++ })
        plank.geometry.addEventListener('dispose', () => { geometryDisposals++ })
      }
      scene.dispose()
      expect(materialDisposals).toBe(2)
      expect(geometryDisposals).toBe(2)
      expect(scene.planks.size).toBe(0)
      expect(scene.scene.children).toHaveLength(0)
    })

    it('disposes a retained plank once when its DOM shelf is removed while offscreen', () => {
      const { scene, element, mesh, untrack } = planks(nodes)
      const material = Array.isArray(mesh.material) ? mesh.material[2]! : mesh.material
      let materialDisposals = 0
      let geometryDisposals = 0
      material.addEventListener('dispose', () => { materialDisposals++ })
      mesh.geometry.addEventListener('dispose', () => { geometryDisposals++ })
      scene.deactivate(element)
      untrack()
      expect(materialDisposals).toBe(1)
      expect(geometryDisposals).toBe(1)
      untrack()
      expect(materialDisposals).toBe(1)
      expect(geometryDisposals).toBe(1)
    })
  })
}
