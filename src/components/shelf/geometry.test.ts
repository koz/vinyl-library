import { expect, it } from 'vitest'
import * as THREE from 'three'
import { createSleeveGeometry, setPlankGrainUVs } from './geometry'
import { RECORD_RADIUS } from './layout'

it('keeps the wood fibers at the same physical scale across plank faces and after resizing', () => {
  const geometry = new THREE.BoxGeometry()
  const normals = geometry.getAttribute('normal')
  const uvs = geometry.getAttribute('uv')
  const span = (face: 'front' | 'top', direction: 'u' | 'v') => {
    const values: number[] = []
    for (let i = 0; i < normals.count; i++) {
      if ((face === 'front' ? normals.getZ(i) : normals.getY(i)) === 1) {
        values.push(direction === 'u' ? uvs.getX(i) : uvs.getY(i))
      }
    }
    return Math.max(...values) - Math.min(...values)
  }
  setPlankGrainUVs(geometry, 900, 16, 56)
  expect(span('front', 'u') / 900).toBeCloseTo(span('front', 'v') / 16, 8)
  expect(span('top', 'u') / 900).toBeCloseTo(span('top', 'v') / 56, 8)
  setPlankGrainUVs(geometry, 450, 20, 56)
  expect(span('front', 'u')).toBeCloseTo(450 / 600, 8)
  expect(span('front', 'v')).toBeCloseTo(20 / 600, 8)
  geometry.dispose()
})

it('keeps the record enclosed by the bent panels and the bottom resting on the shelf', () => {
  const geometry = createSleeveGeometry()
  const material = new THREE.MeshBasicMaterial()
  const sleeve = new THREE.Mesh(geometry, material)
  const ray = new THREE.Raycaster()
  expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 8)
  expect(geometry.boundingBox!.max.y).toBeCloseTo(1, 8)

  for (let y = -0.475; y <= 0.475; y += 0.025) {
    for (let x = -0.475; x <= 0.475; x += 0.025) {
      if (Math.hypot(x, y) > RECORD_RADIUS) continue
      for (const side of [-1, 1]) {
        ray.set(new THREE.Vector3(x, y + 0.5, side), new THREE.Vector3(0, 0, -side))
        const hit = ray.intersectObject(sleeve)[0]
        expect(hit, `panel missing at ${x}, ${y}, side ${side}`).toBeDefined()
        expect(hit!.point.z * side).toBeGreaterThan(0.005 / 2)
      }
    }
  }
  geometry.dispose()
  material.dispose()
})
