import * as THREE from 'three'

/** Rounded timber corners with a smaller, soft edge around the top and bottom. */
export function createPlankGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 17, 9, 17)
  const positions = geometry.getAttribute('position')
  const smoothNormals = new Float32Array(positions.count * 3)
  const corner = Math.min(14, width / 2, depth / 2)
  const edge = Math.min(2, height / 2, corner)
  const dimensions = new THREE.Vector3(width, height, depth)
  const direction = new THREE.Vector3()
  const horizontal = new THREE.Vector2()

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    // Odd segment counts leave a flat span between the curved ends on each axis.
    direction.set(
      x - Math.sign(x) * 0.5 / 17,
      y - Math.sign(y) * 0.5 / 9,
      z - Math.sign(z) * 0.5 / 17,
    )
    horizontal.set(direction.x, direction.z).normalize()
    direction.normalize()
    positions.setXYZ(i,
      (Math.sign(x) * (width / 2 - corner) + horizontal.x * (corner - edge) + direction.x * edge) / width,
      (Math.sign(y) * (height / 2 - edge) + direction.y * edge) / height,
      (Math.sign(z) * (depth / 2 - corner) + horizontal.y * (corner - edge) + direction.z * edge) / depth,
    )
    // The mesh scales a unit plank to its DOM dimensions; compensate its normals here.
    direction.multiply(dimensions).normalize().toArray(smoothNormals, i * 3)
  }

  // Use the original box face directions to keep the grain aligned across the curves.
  setPlankGrainUVs(geometry, width, height, depth)
  geometry.setAttribute('normal', new THREE.BufferAttribute(smoothNormals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** A texture tile covers the same area of timber on the top, front and sides. */
export function setPlankGrainUVs(geometry: THREE.BoxGeometry, width: number, height: number, depth: number) {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const uvs = geometry.getAttribute('uv')
  const tileSize = 600
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const nx = normals.getX(i)
    const ny = normals.getY(i)
    const nz = normals.getZ(i)
    if (nx !== 0) {
      uvs.setXY(i, (0.5 - z * nx) * depth / tileSize, (y + 0.5) * height / tileSize)
    } else if (ny !== 0) {
      uvs.setXY(i, (x + 0.5) * width / tileSize, (0.5 - z * ny) * depth / tileSize)
    } else {
      uvs.setXY(i, (0.5 + x * nz) * width / tileSize, (y + 0.5) * height / tileSize)
    }
  }
  uvs.needsUpdate = true
}

const DEPTH = 0.016
const FOLD_RADIUS = 0.006

// Keep extra vertices near the folds, while leaving enough across the printed panels to bend them.
function panelCoordinate(value: number): number {
  const distance = Math.abs(value)
  const sign = Math.sign(value)
  if (distance <= 0.4375) return sign * distance / 0.4375 * 0.49
  if (distance <= 0.46875) return sign * (0.49 + (distance - 0.4375) / 0.03125 * 0.007)
  return sign * (0.497 + (distance - 0.46875) / 0.03125 * 0.003)
}

function paperBow(x: number, y: number): number {
  const folds = Math.max(0, 1 - (x * 2) ** 8) * Math.max(0, 1 - (y * 2) ** 8)
  // Broad and almost flat over the vinyl, easing down into the folded perimeter.
  return 0.0045 * Math.exp(-((Math.hypot(x, y) / 0.43) ** 4)) * folds
}

/** A closed cardboard jacket, with rounded folds and panels gently bowed around the record. */
export function createSleeveGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, DEPTH, 32, 32, 4)
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const uvs = geometry.getAttribute('uv')
  const point = new THREE.Vector3()
  const fold = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const inner = new THREE.Vector3(0.5 - FOLD_RADIUS, 0.5 - FOLD_RADIUS, DEPTH / 2 - FOLD_RADIUS)
  const minimum = inner.clone().negate()
  const epsilon = 0.0001

  for (let i = 0; i < positions.count; i++) {
    const face = normals.getZ(i)
    point.set(panelCoordinate(positions.getX(i)), panelCoordinate(positions.getY(i)), positions.getZ(i))
    fold.copy(point).clamp(minimum, inner)
    normal.copy(point).sub(fold).normalize()
    point.copy(fold).addScaledVector(normal, FOLD_RADIUS)

    const side = Math.sign(point.z)
    const dx = (paperBow(point.x + epsilon, point.y) - paperBow(point.x - epsilon, point.y)) / (2 * epsilon)
    const dy = (paperBow(point.x, point.y + epsilon) - paperBow(point.x, point.y - epsilon)) / (2 * epsilon)
    point.z += side * paperBow(point.x, point.y)
    // Transform the smooth fold normals with the panel's bend, including shared seam vertices.
    normal.set(normal.x - side * dx * normal.z, normal.y - side * dy * normal.z, normal.z).normalize()
    positions.setXYZ(i, point.x, point.y + 0.5, point.z)
    normals.setXYZ(i, normal.x, normal.y, normal.z)
    // Keep the print registered to the bent surface rather than stretching it across the folds.
    if (face !== 0) uvs.setXY(i, face > 0 ? point.x + 0.5 : 0.5 - point.x, point.y + 0.5)
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
