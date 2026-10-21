import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createWoodMaterial } from './wood-material'

function maps() {
  return {
    color: new THREE.CanvasTexture(), bump: new THREE.CanvasTexture(),
    roughness: new THREE.CanvasTexture(), endGrain: new THREE.CanvasTexture(),
  }
}

describe('natural oak shelves', () => {
  it('uses the selected finish without surface relief on both backends', () => {
    for (const nodes of [true, false]) {
      const wood = createWoodMaterial(maps(), nodes, 0.4)
      const material = (Array.isArray(wood.material) ? wood.material[2]! : wood.material) as THREE.MeshStandardMaterial
      expect(material.bumpScale).toBe(0)
      expect(material.map!.repeat.x).toBe(2.55)
      expect(material.map!.offset.x).toBe(0.4)
      expect(material.roughness).toBeCloseTo(nodes ? 0.7 : 0.7 / 0.85)
      wood.dispose()
    }
  })

  it('uses separate node cache keys so shelves cannot share grain bindings', () => {
    const a = createWoodMaterial(maps(), true, 0.2)
    const b = createWoodMaterial(maps(), true, 0.7)
    expect((a.material as THREE.Material).customProgramCacheKey())
      .not.toBe((b.material as THREE.Material).customProgramCacheKey())
    a.dispose()
    b.dispose()
  })

  it('isolates fallback grain placement and disposal from shared source maps', () => {
    const source = maps()
    const a = createWoodMaterial(source, false, 0.2)
    const b = createWoodMaterial(source, false, 0.7)
    const timber = (a.material as THREE.MeshStandardMaterial[])[2]!
    const other = (b.material as THREE.MeshStandardMaterial[])[2]!
    expect(timber.color.r).toBeCloseTo(1.4 * (1 + 0.3 * 0.14))
    expect(timber.map!.offset.x).toBe(0.2)
    expect(other.map!.offset.x).toBe(0.7)
    expect(source.color.offset.x).toBe(0)
    expect(source.color.repeat.x).toBe(1)
    let disposed = false
    source.color.addEventListener('dispose', () => { disposed = true })
    a.dispose()
    expect(disposed).toBe(false)
    expect(other.map).not.toBe(timber.map)
    b.dispose()
  })
})
