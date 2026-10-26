import * as THREE from 'three'
import { setPlankGrainUVs } from './geometry'
import { createWoodMaterial } from './wood-material'
import type { OakMaps } from './textures'

// Crate dimensions are in sleeve widths. The crate's origin is the centre of its base,
// with +z towards the visitor.
const INNER_WIDTH = 1.07
const INNER_DEPTH = 1
const BOARD = 0.045
const SIDE_BACK = 0.66
const SIDE_FRONT = 0.44
const FRONT_BOARD = 0.3
const BACK_BOARD = 0.6
const BEVEL = 0.006
const OUTER_DEPTH = INNER_DEPTH + BOARD * 2
// Grain UVs assume a typical on-screen size.
const NOMINAL_PIXELS = 400
const GRAIN_STRETCH = 3

/** Records shown standing in the crate; the rest wait, hidden, behind the last one. */
export const CRATE_SLOTS = 30
const SPACING = 0.028
const LEAN = -0.2
const FLOOR = BOARD
// The back record leans on the top of the back board.
const BACK_Z = -INNER_DEPTH / 2 + BACK_BOARD * Math.tan(-LEAN) + 0.014
// The top of a flip, with room to arc over the other records rather than step over them.
const LIFT = 1.15
// The tops of the standing records, plus room for a carried record's roll.
const CLEAR_Y = FLOOR + Math.cos(LEAN) + 0.03
// Deep enough to drop behind the record in front, shallow enough that the part below the floor
// stays hidden behind the front board when the crate is seen from above.
const SINK = 0.28
const PEEK = 0.05
const UPRIGHT = 0.06
/** Fraction of a flip after which a lifted record has cleared its neighbours. */
const CLEAR = 0.3
// Records shuffle along on a critically damped spring. Closing up behind a record taken from the
// front, each starts a moment after the one ahead of it.
const SHIFT_STIFFNESS = 16
const STAGGER = 0.004
// A record about to be lowered in waits until its neighbours are at least this far apart, in slots.
const LANDING_ROOM = 0.95

export const FLIP_SECONDS = 0.7
// Flipping steadily (a held key, a long scroll), records go quicker and the stack follows faster,
// so the front fills in before the next record is picked up.
export const QUICK_FLIP_SECONDS = 0.36
const QUICK_STIFFNESS = 30
/** Seen straight on from slightly above, like a crate on a low shelf. */
export const CRATE_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0))
// Room above the crate, in sleeve widths, for records being flipped.
const HEADROOM = 0.72
const FILL = 0.9

export type CratePose = { x: number; y: number; z: number; rx: number; rz: number }

export type CrateSlot = {
  /** Position in the crate counted from the front, wrapping around the collection. */
  offset: number
  /** Animated position, in the same units as `offset`. */
  slot: number
  /** Slots per second, while shuffling along. */
  velocity: number
  /** Seconds to wait before shuffling along, so the stack moves as a ripple. */
  delay: number
  /**
   * Set while the record is carried over the others to the other end of the crate. Once it starts
   * lowering in, `land` fixes where it comes down; it shuffles along with the others after that.
   */
  lift: { from: number; to: number; t: number; land?: number } | null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
// Eases in and out with no jolt at either end: its acceleration also starts and ends at zero.
const ease = (t: number) => t ** 4 * (35 - 84 * t + 70 * t * t - 20 * t ** 3)
// Starts gently, does most of its travel early, then eases to a stop: a hand lifting something.
export const pickUp = (t: number) => 1 - (1 - t) ** 4 * (1 + 4 * t)
const lastSlot = (count: number) => Math.max(0, Math.min(count, CRATE_SLOTS) - 1)

/**
 * Where a record stands at `slot`. Slots past the last visible one slide down out of sight behind
 * it, along their lean like every other move in the crate.
 */
export function slotPose(slot: number, count: number): CratePose {
  const back = lastSlot(count)
  const behind = clamp(slot - back, 0, 1)
  return {
    x: 0,
    y: FLOOR - behind * SINK,
    z: BACK_Z + (back - Math.min(slot, back) - behind) * SPACING - behind * SINK * Math.tan(LEAN),
    rx: LEAN,
    rz: 0,
  }
}

/** Moves a record along its own lean, so it slides past its neighbours instead of through them. */
export function raisePose(pose: CratePose, height: number): CratePose {
  return { ...pose, y: pose.y + height, z: pose.z + height * Math.tan(LEAN) }
}

/** The fraction of the rise, from 0 to 1, at which a record lifted from `y` reaches `target`. */
function riseTime(y: number, peak: number, target: number): number {
  const goal = clamp((target - y) / (peak - y), 0, 1)
  let low = 0
  let high = 1
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    if (pickUp(mid) < goal) low = mid
    else high = mid
  }
  return high
}

/**
 * A record picked up out of the crate, carried over the others and lowered in at the other end.
 * It rises in one steady arc, easing upright and back, and only moves along the crate once it is
 * clear of the other records. The path is symmetric, so reversing a flip midway
 * retraces it.
 */
export function liftPose(from: CratePose, to: CratePose, t: number): CratePose {
  const peak = FLOOR + LIFT
  const rising = t < 0.5
  const y = rising
    ? from.y + (peak - from.y) * pickUp(t * 2)
    : to.y + (peak - to.y) * pickUp((1 - t) * 2)
  const start = riseTime(from.y, peak, CLEAR_Y) / 2
  const end = 1 - riseTime(to.y, peak, CLEAR_Y) / 2
  const along = clamp((t - start) / (end - start), 0, 1)
  const move = ease(along)
  const base = THREE.MathUtils.lerp(from.y, to.y, move)
  const air = Math.sin(Math.PI * move)
  return {
    x: 0,
    y,
    // Up and down along the lean, so the record slides past its neighbours instead of through them.
    z: THREE.MathUtils.lerp(from.z, to.z, move) + (y - base) * Math.tan(LEAN),
    rx: LEAN + (UPRIGHT - LEAN) * air,
    rz: 0,
  }
}

/** A small, stable irregularity per record, so a full crate reads as separate sleeves. */
function jitter(id: number) {
  const random = (seed: number) => {
    const value = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453
    return (value - Math.floor(value)) * 2 - 1
  }
  return { x: random(1) * 0.012, lean: random(2) * 0.005, roll: random(3) * 0.008 }
}

/**
 * Record `id`'s current pose, raised by `hover` (0 to 1) when the pointer is over it.
 */
export function crateSleevePose(
  slot: CrateSlot, count: number, hover: number, id = 0,
): CratePose & { visible: boolean } {
  const pose = slot.lift
    ? liftPose(slotPose(slot.lift.from, count), slotPose(slot.lift.land ?? slot.lift.to, count), slot.lift.t)
    : slotPose(slot.slot, count)
  const offset = jitter(id)
  const raised = raisePose(pose, hover * PEEK)
  return {
    ...raised,
    x: raised.x + offset.x,
    rx: raised.rx + offset.lean,
    rz: raised.rz + offset.roll,
    visible: slot.lift !== null || slot.slot < lastSlot(count) + 1,
  }
}

/**
 * A record newly kept in the crate, standing at `offset`. A `carried` one comes up from out of
 * sight behind the others and is carried over them to its place.
 */
export function placeSlot(offset: number, count: number, carried = false): CrateSlot {
  if (!carried) return { offset, slot: offset, velocity: 0, delay: 0, lift: null }
  const hidden = lastSlot(count) + 1
  return { offset, slot: hidden, velocity: 0, delay: 0, lift: { from: hidden, to: offset, t: 0 } }
}

/**
 * Gives a record a new place in the crate. Flipping forward (`direction` 1) carries the front
 * record to the back; flipping back (-1) carries the back record to the front. A `carried` record
 * is lifted out from wherever it stands, as when it is pulled out to the front.
 */
export function moveSlot(slot: CrateSlot, offset: number, count: number, direction: number, carried = false) {
  if (slot.offset === offset) return
  const wrapped = carried || (direction > 0
    ? slot.offset === 0 && offset === count - 1
    : direction < 0 && slot.offset === count - 1 && offset === 0)
  if (wrapped) {
    slot.lift = slot.lift
      ? { from: slot.lift.land ?? slot.lift.to, to: offset, t: 1 - slot.lift.t }
      : { from: slot.slot, to: offset, t: 0 }
  } else if (slot.lift) {
    slot.lift.to = offset
  } else if (slot.slot === slot.offset && slot.velocity === 0 && direction > 0) {
    // Closing the gap at the front, records further back start a little later, so the stack
    // ripples. Making room at the front for a record coming over the top, they move back together.
    slot.delay = offset * STAGGER
  }
  slot.offset = offset
}

/** Advances a critically damped spring towards `target` by `dt`, exactly. */
function spring(position: number, velocity: number, target: number, dt: number, w: number) {
  const c1 = position - target
  const c2 = velocity + w * c1
  const decay = Math.exp(-w * dt)
  return {
    position: target + (c1 + c2 * dt) * decay,
    velocity: (c2 - w * (c1 + c2 * dt)) * decay,
  }
}

/**
 * Advances every record towards its place. Records shuffle along together, but none moves into
 * the space of a record that is still being lifted out of it, and a record coming over the top
 * waits in the air until there is room to lower it in. `quick` paces everything for steady
 * flipping. Returns whether anything is moving.
 */
export function settleSlots(
  slots: Iterable<CrateSlot>, count: number, dt: number, instant: boolean, quick = false,
): boolean {
  const seconds = quick ? QUICK_FLIP_SECONDS : FLIP_SECONDS
  const stiffness = quick ? QUICK_STIFFNESS : SHIFT_STIFFNESS
  const hidden = lastSlot(count) + 1
  let animating = false
  type Entry = { slot: CrateSlot; at: number; next: number; free: number; room: boolean }
  const queue: Entry[] = []
  const lifts: CrateSlot[] = []
  // Records being lifted out of the stack keep their place until they clear it, and records being
  // lowered in keep theirs until they are down.
  const lifting: number[] = []
  for (const slot of slots) {
    if (slot.lift) {
      lifts.push(slot)
      if (!instant && slot.lift.t < CLEAR) lifting.push(Math.min(slot.lift.from, hidden))
      if (!instant && slot.lift.land !== undefined) lifting.push(Math.min(slot.lift.land, hidden))
      continue
    }
    // Steady flipping is too quick for a ripple; the stack moves as one.
    if (instant || quick) slot.delay = 0
    let next = slot.offset
    let velocity = 0
    if (!instant && slot.slot !== slot.offset) {
      if (slot.delay > 0) {
        next = slot.slot
      } else {
        ({ position: next, velocity } = spring(slot.slot, slot.velocity, slot.offset, dt, stiffness))
        if (Math.abs(next - slot.offset) < 0.001 && Math.abs(velocity) < 0.05) {
          next = slot.offset
          velocity = 0
        }
      }
    }
    slot.velocity = velocity
    queue.push({ slot, at: slot.slot, next, free: next, room: true })
  }
  // Records keep their order in the crate: moving forward, each stays a slot behind the record
  // ahead of it, and moving back, a slot ahead of the one behind. Only a neighbour that really is
  // in the way counts, so records that end up side by side never hold each other up. A waiting
  // record starts its count once no lifted record is in its way.
  queue.sort((a, b) => a.slot.offset - b.slot.offset)
  queue.forEach((entry, i) => {
    if (entry.slot.offset >= entry.at) return
    const ahead = queue[i - 1]
    let limit = -Infinity
    for (const at of lifting) if (at < entry.at) limit = Math.max(limit, at + 1)
    entry.room = limit < entry.at - 0.0001
    if (ahead && ahead.at < entry.at) limit = Math.max(limit, ahead.next + 1)
    entry.next = Math.max(entry.next, Math.min(entry.at, limit))
  })
  for (let i = queue.length - 1; i >= 0; i--) {
    const entry = queue[i]!
    if (entry.slot.offset <= entry.at) continue
    const behind = queue[i + 1]
    let limit = Infinity
    for (const at of lifting) if (at > entry.at) limit = Math.min(limit, at - 1)
    entry.room = limit > entry.at + 0.0001
    if (behind && behind.at > entry.at) limit = Math.min(limit, behind.next - 1)
    entry.next = Math.min(entry.next, Math.max(entry.at, limit))
  }
  for (const { slot, next, free, room } of queue) {
    if (slot.delay > 0 && room) slot.delay -= dt
    // A record held back by its neighbour loses its momentum.
    if (next !== free) slot.velocity = 0
    slot.slot = next
    if (next !== slot.offset) animating = true
  }
  const peak = FLOOR + LIFT
  for (const slot of lifts) {
    const lift = slot.lift!
    let t = instant ? 1 : Math.min(1, lift.t + dt / seconds)
    // Hold the record above the others until the records around its place have made room, then
    // lower it in there.
    const lowering = 1 - riseTime(slotPose(lift.to, count).y, peak, CLEAR_Y) / 2
    if (!instant && t > lowering && lift.land === undefined) {
      const near = (at: number) => Math.abs(Math.min(at, hidden) - lift.to) < LANDING_ROOM
      const crowded = lift.to < hidden && (queue.some(({ slot: other }) => near(other.slot))
        || lifts.some((other) => other !== slot && other.lift?.land !== undefined && near(other.lift.land)))
      if (crowded) t = lowering
      else lift.land = lift.to
    }
    lift.t = t
    if (t < 1) {
      animating = true
      continue
    }
    slot.slot = lift.land ?? lift.to
    slot.velocity = 0
    slot.lift = null
  }
  return animating
}

/**
 * Which records to keep in the scene for the record at `front`: the visible ones, a few hidden
 * behind them, and the most recently flipped, which may still be in the air.
 */
export function crateWindow(count: number, front: number): { index: number; offset: number }[] {
  const ahead = CRATE_SLOTS + 4
  // Enough for every record still in the air at the quickest pace the crate allows.
  const returning = 8
  const offsets = count <= ahead + returning
    ? Array.from({ length: count }, (_, offset) => offset)
    : [
      ...Array.from({ length: ahead }, (_, offset) => offset),
      ...Array.from({ length: returning }, (_, i) => count - returning + i),
    ]
  return offsets.map((offset) => ({ index: (front + offset) % count, offset }))
}

const corners = (() => {
  const halfWidth = INNER_WIDTH / 2 + BOARD
  const points: THREE.Vector3[] = []
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [0, FLOOR + 1]) {
      for (const z of [-OUTER_DEPTH / 2 - 0.12, OUTER_DEPTH / 2]) {
        points.push(new THREE.Vector3(x, y, z).applyQuaternion(CRATE_ROTATION))
      }
    }
  }
  const box = new THREE.Box3().setFromPoints(points)
  return { points, box, width: box.max.x - box.min.x, height: box.max.y - box.min.y }
})()

/**
 * Places the crate at the bottom of `rect`, as large as fits with room above for flipping.
 * Its front stays at the depth that the page's CSS pixels map to, behind the stage's scrim.
 */
export function fitCrate(
  rect: { left: number; bottom: number; width: number; height: number },
  view: { width: number; height: number; distance: number },
): { position: THREE.Vector3; scale: number } {
  const { points, box, width, height } = corners
  const screen = Math.max(1, Math.min(rect.width * FILL / width, rect.height / (height + HEADROOM)))
  const scale = screen / (1 - screen * box.max.z / view.distance)
  const z = -box.max.z * scale
  // How much nearer parts of the crate are magnified: a CSS pixel at depth `depth` spans `k` units.
  const k = (depth: number) => (view.distance - depth) / view.distance
  const bottom = view.height / 2 - rect.bottom
  // Rest the lowest corner, as drawn in perspective, on the bottom of `rect`.
  const y = Math.max(...points.map((point) => bottom * k(z + point.z * scale) - point.y * scale))
  return {
    position: new THREE.Vector3(
      (rect.left + rect.width / 2 - view.width / 2) * k(z) - (box.min.x + box.max.x) / 2 * scale,
      y,
      z,
    ),
    scale,
  }
}

type Board = {
  mesh: THREE.Mesh
  wood: ReturnType<typeof createWoodMaterial>
  size: THREE.Vector3
}

/** An extruded board, normalised to a unit box so the wood shader sees the same space as a plank. */
function boardGeometry(shape: THREE.Shape, depth: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - BEVEL * 2,
    curveSegments: 48,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
    bevelOffset: -BEVEL,
  })
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  geometry.translate(-center.x, -center.y, -center.z)
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z)
  setPlankGrainUVs(geometry, size.x * NOMINAL_PIXELS, size.y * NOMINAL_PIXELS, size.z * NOMINAL_PIXELS)
  // A whole board face would show the oak photo's knots at full size. Drawing it out along the
  // grain gives the long, straight figure of a sawn board instead.
  const uvs = geometry.getAttribute('uv')
  for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) / GRAIN_STRETCH)
  geometry.computeBoundingSphere()
  return { geometry, size }
}

function rectangle(width: number, height: number) {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, 0)
  shape.lineTo(width, height)
  shape.lineTo(0, height)
  shape.closePath()
  return shape
}

/** Side panel profile, from the front edge (x = 0) to the back, with a round handle. */
function sideShape() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(OUTER_DEPTH, 0)
  shape.lineTo(OUTER_DEPTH, SIDE_BACK)
  shape.lineTo(0, SIDE_FRONT)
  shape.closePath()
  const handle = new THREE.Path()
  handle.absarc(OUTER_DEPTH * 0.46, 0.27, 0.105, 0, Math.PI * 2, true)
  shape.holes.push(handle)
  return shape
}

/** The wooden crate, in sleeve widths, made from the same oak as the shelves. */
export function createCrateModel(oak: OakMaps, nodes: boolean) {
  const group = new THREE.Group()
  group.matrixAutoUpdate = false
  const boards: Board[] = []

  const addBoard = (shape: THREE.Shape, depth: number, position: THREE.Vector3, turn = 0) => {
    const { geometry, size } = boardGeometry(shape, depth)
    const wood = createWoodMaterial(oak, nodes, Math.random())
    // The WebGL fallback's end-grain material is indexed by box faces, which an extrusion lacks.
    const material = Array.isArray(wood.material) ? wood.material[2] : wood.material
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.copy(size)
    mesh.position.copy(position)
    mesh.rotation.y = turn
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    boards.push({ mesh, wood, size })
  }

  const sideX = INNER_WIDTH / 2 + BOARD / 2
  const endZ = INNER_DEPTH / 2 + BOARD / 2
  // Turning the profile a quarter turn runs its front edge towards +z.
  addBoard(sideShape(), BOARD, new THREE.Vector3(-sideX, SIDE_BACK / 2, 0), Math.PI / 2)
  addBoard(sideShape(), BOARD, new THREE.Vector3(sideX, SIDE_BACK / 2, 0), Math.PI / 2)
  addBoard(rectangle(INNER_WIDTH, FRONT_BOARD), BOARD, new THREE.Vector3(0, FRONT_BOARD / 2, endZ))
  addBoard(rectangle(INNER_WIDTH, BACK_BOARD), BOARD, new THREE.Vector3(0, BACK_BOARD / 2, -endZ))
  addBoard(rectangle(INNER_WIDTH, BOARD), INNER_DEPTH, new THREE.Vector3(0, BOARD / 2, 0))

  // Grounds the crate with its shadow, without drawing a surface.
  const floorOpacity = 0.14
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    // Without depth, the stage's scrim still covers the crate wherever the floor is nearer.
    new THREE.ShadowMaterial({ opacity: floorOpacity, depthWrite: false }),
  )
  floor.scale.set(INNER_WIDTH + 2.6, 1, OUTER_DEPTH + 1.8)
  floor.position.set(0, 0.0005, -0.7)
  floor.receiveShadow = true
  group.add(floor)

  let scale = 0
  return {
    group,
    boards,
    /** Updates the crate's size in CSS pixels per sleeve width, and how much the scrim covers it. */
    update(pixels: number, scrim: number) {
      floor.material.opacity = floorOpacity * (1 - scrim)
      if (pixels === scale) return
      scale = pixels
      for (const { wood, size } of boards) wood.setDimensions(size.x * pixels, size.y * pixels, size.z * pixels)
    },
    dispose() {
      for (const { mesh, wood } of boards) {
        mesh.geometry.dispose()
        wood.dispose()
      }
      floor.geometry.dispose()
      floor.material.dispose()
    },
  }
}

export type CrateModel = ReturnType<typeof createCrateModel>
