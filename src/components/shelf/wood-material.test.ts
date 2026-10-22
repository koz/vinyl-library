import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type MaterialReferenceNode from 'three/src/nodes/accessors/MaterialReferenceNode.js'
import type Node from 'three/src/nodes/core/Node.js'
import { NodeFrame } from 'three/webgpu'
import type TextureNode from 'three/src/nodes/accessors/TextureNode.js'
import type { WoodNodeMaterial } from 'three/examples/jsm/materials/WoodNodeMaterial.js'
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

  it('reuses the oak shader across different shelves and shelves recreated after scrolling', () => {
    const source = maps()
    const a = createWoodMaterial(source, true, 0.2)
    const key = (a.material as THREE.Material).customProgramCacheKey()
    const b = createWoodMaterial(source, true, 0.7)
    expect((b.material as THREE.Material).customProgramCacheKey()).toBe(key)
    a.dispose()
    const returned = createWoodMaterial(source, true, 0.2)
    expect((returned.material as THREE.Material).customProgramCacheKey()).toBe(key)
    b.dispose()
    returned.dispose()
  })

  it('binds the shared shader to each shelf’s own grain texture and tint', () => {
    const source = maps()
    const a = createWoodMaterial(source, true, 0.2)
    const b = createWoodMaterial(source, true, 0.7)
    const timber = a.material as WoodNodeMaterial & { colorNode: Node }
    const other = b.material as WoodNodeMaterial
    const bindings = new Map<string, MaterialReferenceNode>()
    timber.colorNode.traverse((node) => {
      if ('isMaterialReferenceNode' in node && node.isMaterialReferenceNode) {
        const binding = node as MaterialReferenceNode
        bindings.set(binding.property, binding)
      }
    })
    const map = bindings.get('map')!
    const color = bindings.get('color')!
    expect(map, 'grain texture must follow the currently rendered material').toBeDefined()
    expect(color, 'tint must follow the currently rendered material').toBeDefined()
    for (const material of [timber, other, timber]) {
      const frame = new NodeFrame()
      frame.material = material
      map.updateReference(frame)
      map.update(frame)
      color.updateReference(frame)
      color.update(frame)
      expect((map.node as TextureNode).value).toBe(material.map)
      expect((color.node as unknown as { value: THREE.Color }).value).toBe(material.color)
    }
    expect(timber.map!.offset.x).toBe(0.2)
    expect(other.map!.offset.x).toBe(0.7)
    expect(timber.color.r).toBeCloseTo(1.4 * (1 + 0.3 * 0.14))
    a.setDimensions(900, 16, 56)
    b.setDimensions(1200, 16, 56)
    // Texture placement and the procedural grain transform remain independent.
    expect(timber.transformationMatrix.equals(other.transformationMatrix)).toBe(false)
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
