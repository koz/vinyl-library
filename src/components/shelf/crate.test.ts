import { describe, expect, it } from 'vitest'
import {
  CRATE_SLOTS,
  FLIP_SECONDS,
  HELD_MAX_SPEED,
  HELD_RAMP_SECONDS,
  crateSleevePose,
  crateWindow,
  hidesStack,
  heldSpeed,
  liftPose,
  moveSlot,
  placeSlot,
  settleSlots,
  slotPose,
  type CrateSlot,
} from './crate'

const stack = (count: number): CrateSlot[] =>
  Array.from({ length: count }, (_, offset) => ({ offset, slot: offset, velocity: 0, delay: 0, lift: null }))

function flip(slots: CrateSlot[], count: number, direction: number) {
  for (const slot of slots) moveSlot(slot, (slot.offset - direction + count) % count, count, direction)
}

describe('crate slots', () => {
  it('stands every record of a small collection in the crate', () => {
    for (let slot = 0; slot < 12; slot++) {
      expect(crateSleevePose({ offset: slot, slot, velocity: 0, delay: 0, lift: null }, 12, 0).visible).toBe(true)
    }
  })

  it('hides records past the last visible slot below the ones in front', () => {
    const count = CRATE_SLOTS + 20
    const last = slotPose(CRATE_SLOTS - 1, count)
    const hidden = slotPose(CRATE_SLOTS + 5, count)
    expect(hidden.y).toBeLessThan(last.y - 0.25)
    // Compared at the same height, the hidden sleeve stands behind the last visible one.
    expect(hidden.z + (last.y - hidden.y) * Math.tan(hidden.rx)).toBeLessThan(last.z - 0.02)
    expect(crateSleevePose({ offset: CRATE_SLOTS + 5, slot: CRATE_SLOTS + 5, velocity: 0, delay: 0, lift: null }, count, 0).visible).toBe(false)
  })
})

describe('flipping', () => {
  it('carries the front record to the back when flipping forward', () => {
    const slots = stack(5)
    flip(slots, 5, 1)
    expect(slots[0]).toMatchObject({ offset: 4, lift: { from: 0, to: 4, t: 0 } })
    for (const slot of slots.slice(1)) expect(slot.lift).toBeNull()
  })

  it('carries the back record to the front when flipping back', () => {
    const slots = stack(5)
    flip(slots, 5, -1)
    expect(slots[4]).toMatchObject({ offset: 0, lift: { from: 4, to: 0, t: 0 } })
  })

  it('retraces a flip that is reversed in the air', () => {
    const count = 5
    const slots = stack(count)
    flip(slots, count, 1)
    settleSlots(slots, count, FLIP_SECONDS * 0.4, false)
    const before = crateSleevePose(slots[0]!, count, 0)
    flip(slots, count, -1)
    const after = crateSleevePose(slots[0]!, count, 0)
    for (const key of ['y', 'z', 'rx', 'rz'] as const) expect(after[key]).toBeCloseTo(before[key], 10)
  })

  it('lifts the record clear of the others before carrying it over them', () => {
    const count = 20
    const from = slotPose(0, count)
    const to = slotPose(count - 1, count)
    const tops = from.y + Math.cos(from.rx)
    for (let t = 0; t <= 1; t += 0.01) {
      const pose = liftPose(from, to, t)
      if (pose.y > tops) continue
      // Below the tops, the record only slides along its own lean at either end.
      const along = pose.z - (pose.y - from.y) * Math.tan(from.rx)
      expect(Math.min(Math.abs(along - from.z), Math.abs(along - to.z))).toBeLessThan(0.005)
    }
  })

  it('keeps the next record in place until the lifted one has cleared it', () => {
    const count = 5
    const slots = stack(count)
    flip(slots, count, 1)
    settleSlots(slots, count, FLIP_SECONDS * 0.1, false)
    expect(slots[1]!.slot).toBe(1)
    expect(slots[4]!.slot).toBe(4)
    for (let i = 0; i < 60; i++) settleSlots(slots, count, 1 / 60, false)
    expect(slots.map((slot) => slot.slot)).toEqual([4, 0, 1, 2, 3])
    expect(slots[0]!.lift).toBeNull()
  })

  it('moves without sudden changes of speed', () => {
    const count = CRATE_SLOTS + 10
    for (const [from, to] of [[0, count - 1], [count - 1, 0], [0, 12]] as const) {
      const start = slotPose(from, count)
      const end = slotPose(to, count)
      const step = 1 / 600
      const position = (t: number) => {
        const pose = liftPose(start, end, t)
        return [pose.y, pose.z, pose.rx]
      }
      let previous: number[] | null = null
      for (let t = step; t <= 1 - step; t += step) {
        const before = position(t - step)
        const after = position(t + step)
        const velocity = after.map((value, i) => (value - before[i]!) / (2 * step))
        const last = previous
        // Per-frame changes in velocity stay small: no corners in the path.
        if (last) velocity.forEach((value, i) => expect(Math.abs(value - last[i]!)).toBeLessThan(0.35))
        previous = velocity
      }
    }
  })

  it('carries the record without wobbling', () => {
    const count = CRATE_SLOTS + 10
    for (const [from, to] of [[0, count - 1], [count - 1, 0], [0, 12], [12, 0]] as const) {
      const start = slotPose(from, count)
      const end = slotPose(to, count)
      const keys = ['y', 'z', 'rx', 'rz'] as const
      const reversals = { y: 0, z: 0, rx: 0, rz: 0 }
      let last = liftPose(start, end, 0)
      let direction: Record<string, number> = {}
      for (let t = 0.002; t <= 1; t += 0.002) {
        const pose = liftPose(start, end, t)
        for (const key of keys) {
          const change = pose[key] - last[key]
          if (Math.abs(change) < 1e-9) continue
          if (direction[key] && Math.sign(change) !== direction[key]) reversals[key]++
          direction = { ...direction, [key]: Math.sign(change) }
        }
        last = pose
      }
      // Up then down, leaning upright then back: each turns around at most once.
      expect(reversals.y).toBeLessThanOrEqual(1)
      expect(reversals.z).toBeLessThanOrEqual(1)
      expect(reversals.rx).toBeLessThanOrEqual(1)
      expect(reversals.rz).toBe(0)
    }
  })

  it('starts the record next to the gap moving first, and the others in turn', () => {
    const count = 10
    const slots = stack(count)
    flip(slots, count, 1)
    let rippled = false
    for (let i = 0; i < 60; i++) {
      const before = slots.map((slot) => slot.slot)
      settleSlots(slots, count, 1 / 120, false)
      // Each record only ever moves towards its place: no stutter back and forth.
      slots.slice(1).forEach((slot, index) => expect(slot.slot).toBeLessThanOrEqual(before[index + 1]!))
      const moved = slots.slice(1).map((slot, index) => index + 1 - slot.slot)
      if (moved[0]! > 0.05 && moved.at(-1)! < moved[0]! / 2) rippled = true
      // Never out of order: no record gets ahead of the one in front of it.
      for (let index = 1; index < moved.length; index++) expect(moved[index]).toBeLessThanOrEqual(moved[index - 1]! + 1e-9)
    }
    expect(rippled).toBe(true)
    for (let i = 0; i < 240; i++) settleSlots(slots, count, 1 / 120, false)
    expect(slots.map((slot) => slot.slot)).toEqual([9, 0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('lowers a flipped record in without waiting in the air for room', () => {
    for (const direction of [1, -1]) {
      for (const count of [5, 10, CRATE_SLOTS, CRATE_SLOTS + 10]) {
        for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
          const slots = stack(count)
          flip(slots, count, direction)
          const carried = slots[direction > 0 ? 0 : count - 1]!
          while (carried.lift) {
            const t = carried.lift.t
            settleSlots(slots, count, dt, false)
            if (carried.lift) expect(carried.lift.t).toBeGreaterThan(t)
          }
          expect(carried.slot).toBe(direction > 0 ? count - 1 : 0)
        }
      }
    }
  })

  it('moves the stack along at the same easy pace either way', () => {
    const count = 10
    const dt = 1 / 120
    const peaks = [1, -1].map((direction) => {
      const slots = stack(count)
      flip(slots, count, direction)
      // The record next to the gap.
      const watched = slots[direction > 0 ? 1 : 0]!
      let peak = 0
      let speed = 0
      for (let i = 0; i < 120; i++) {
        const before = watched.slot
        settleSlots(slots, count, dt, false)
        const now = Math.abs(watched.slot - before) / dt
        // Gathering and losing speed gradually, with no kick at the start.
        expect(Math.abs(now - speed)).toBeLessThan(1)
        speed = now
        peak = Math.max(peak, now)
      }
      expect(watched.slot).toBe(watched.offset)
      return peak
    })
    for (const peak of peaks) expect(peak).toBeLessThan(6)
    expect(Math.abs(peaks[0]! - peaks[1]!)).toBeLessThan(0.5)
  })

  it('settles immediately with reduced motion', () => {
    const count = 5
    const slots = stack(count)
    flip(slots, count, -1)
    expect(settleSlots(slots, count, 1 / 60, true)).toBe(false)
    expect(slots.map((slot) => slot.slot)).toEqual([1, 2, 3, 4, 0])
  })
})

describe('pulling a record out to the front', () => {
  // The record at `from` goes to the front; the ones before it move back a slot to make room.
  function pull(slots: CrateSlot[], count: number, from: number) {
    for (const slot of slots) {
      const offset = slot.offset === from ? 0 : slot.offset < from ? slot.offset + 1 : slot.offset
      moveSlot(slot, offset, count, -1, slot.offset === from)
    }
  }

  // The closest a standing record comes to another, or to the pulled record while it is low enough
  // to be among them.
  function closest(slots: CrateSlot[], count: number) {
    let gap = Infinity
    const standing = slots.filter((slot) => !slot.lift).map((slot) => slot.slot).sort((a, b) => a - b)
    for (let i = 1; i < standing.length; i++) gap = Math.min(gap, standing[i]! - standing[i - 1]!)
    for (const slot of slots) {
      const lift = slot.lift
      if (!lift) continue
      const to = lift.land ?? lift.to
      if (liftPose(slotPose(lift.from, count), slotPose(to, count), lift.t).y > 1) continue
      const at = lift.t < 0.5 ? lift.from : to
      for (const other of standing) gap = Math.min(gap, Math.abs(other - at))
    }
    return gap
  }

  it('lifts the record out from where it stands and lowers it in at the front', () => {
    const count = 10
    const slots = stack(count)
    pull(slots, count, 6)
    expect(slots[6]).toMatchObject({ offset: 0, lift: { from: 6, to: 0, t: 0 } })
    for (const slot of slots) if (slot !== slots[6]) expect(slot.lift).toBeNull()
    for (let i = 0; i < 180; i++) {
      settleSlots(slots, count, 1 / 60, false)
      // A sleeve is about 0.9 slots thick, so records closer than that pass through each other.
      expect(closest(slots, count)).toBeGreaterThan(0.9)
    }
    expect(slots.map((slot) => slot.slot)).toEqual([1, 2, 3, 4, 5, 6, 0, 7, 8, 9])
    for (const slot of slots) expect(slot.lift).toBeNull()
  })

  it('comes down without stopping, passing where it hides the records behind it', () => {
    for (const [count, from, dt] of [[10, 6, 1 / 60], [10, 9, 1 / 20], [CRATE_SLOTS, 20, 1 / 144], [CRATE_SLOTS, 2, 1 / 30]] as const) {
      const slots = stack(count)
      pull(slots, count, from)
      const pulled = slots[from]!
      let hid = false
      while (pulled.lift) {
        const t = pulled.lift.t
        settleSlots(slots, count, dt, false)
        if (pulled.lift) expect(pulled.lift.t).toBeGreaterThan(t)
        if (hid || !hidesStack(pulled, count)) continue
        hid = true
        // The first frame drawn there: low enough that the record behind it is out of sight below
        // the front board, and still well above the floor, so the tops of the others are hidden too.
        const { y } = crateSleevePose(pulled, count, 0)
        expect(y).toBeLessThan(0.3 + 1e-6)
        if (dt < 0.02) expect(y).toBeGreaterThan(slotPose(0, count).y + 0.15)
      }
      expect(hid).toBe(true)
      expect(pulled).toMatchObject({ slot: 0, lift: null })
    }
  })

  it('brings a record from out of sight up from behind the others', () => {
    const count = CRATE_SLOTS + 20
    const slots = stack(CRATE_SLOTS)
    for (const slot of slots) moveSlot(slot, slot.offset + 1, count, -1)
    const pulled = placeSlot(0, count, true)
    expect(crateSleevePose(pulled, count, 0).visible).toBe(true)
    expect(liftPose(slotPose(pulled.lift!.from, count), slotPose(0, count), 0).y).toBeLessThan(slotPose(CRATE_SLOTS - 1, count).y)
    const all = [...slots, pulled]
    for (let i = 0; i < 180; i++) {
      const t = pulled.lift?.t
      settleSlots(all, count, 1 / 60, false)
      expect(closest(all, count)).toBeGreaterThan(0.9)
      // It never waits in the air for room.
      if (t !== undefined && pulled.lift) expect(pulled.lift.t).toBeGreaterThan(t)
    }
    expect(pulled).toMatchObject({ slot: 0, lift: null })
  })
})

describe('flipping one record after another', () => {
  // Mirrors the scene and the crate's queue: the window of records kept loaded, and each of the
  // `steps` flipped as soon as the crate is still after the one before, each taking `seconds`.
  function flipInTurn(steps: number[], count = 45, seconds = FLIP_SECONDS) {
    let front = 0
    const slots = new Map<number, CrateSlot>()
    const lifts: { from: number; frames: number }[] = []
    let inFlight = 0
    let dropped = 0
    // Frames in which a record in the air made no progress.
    let waited = 0
    // The closest any two records come, in slots, where they could touch: standing records in
    // view, and a record low enough to be among them while it is lifted out or lowered in.
    let minGap = Infinity
    const measure = () => {
      const standing = [...slots.values()].filter((slot) => !slot.lift && slot.slot < CRATE_SLOTS)
        .map((slot) => slot.slot).sort((a, b) => a - b)
      for (let i = 1; i < standing.length; i++) minGap = Math.min(minGap, standing[i]! - standing[i - 1]!)
      for (const slot of slots.values()) {
        const lift = slot.lift
        if (!lift) continue
        const to = lift.land ?? lift.to
        if (liftPose(slotPose(lift.from, count), slotPose(to, count), lift.t).y > 1) continue
        const at = Math.min(lift.t < 0.5 ? lift.from : to, CRATE_SLOTS)
        if (at >= CRATE_SLOTS) continue
        for (const other of standing) minGap = Math.min(minGap, Math.abs(other - at))
      }
    }
    const arrange = (step: number) => {
      const window = crateWindow(count, front)
      const kept = new Set(window.map(({ index }) => index))
      for (const [index, slot] of slots) {
        if (kept.has(index)) continue
        if (slot.lift) dropped++
        slots.delete(index)
      }
      for (const { index, offset } of window) {
        const slot = slots.get(index)
        if (!slot) {
          slots.set(index, { offset, slot: offset, velocity: 0, delay: 0, lift: null })
          continue
        }
        const lifting = slot.lift
        moveSlot(slot, offset, count, step)
        if (!lifting && slot.lift) lifts.push({ from: slot.lift.from, frames: 0 })
      }
    }
    arrange(0)
    const waiting = [...steps]
    let moving = false
    for (let frame = 0; frame < 60 * (steps.length + 2); frame++) {
      const step = moving ? undefined : waiting.shift()
      if (step !== undefined) {
        front = (front + step + count) % count
        arrange(step)
      }
      const before = new Map([...slots.values()].map((slot) => [slot, slot.lift?.t]))
      moving = settleSlots(slots.values(), count, 1 / 60, false, seconds)
      for (const [slot, t] of before) if (t !== undefined && slot.lift && slot.lift.t === t) waited++
      if ([...slots.values()].some((slot) => slot.lift)) lifts.at(-1)!.frames++
      measure()
      inFlight = Math.max(inFlight, [...slots.values()].filter((slot) => slot.lift).length)
    }
    return { lifts, inFlight, dropped, minGap, waited, left: waiting.length, slots: [...slots.values()] }
  }

  const runs = {
    forward: Array<number>(12).fill(1),
    back: Array<number>(12).fill(-1),
    'changing direction': [1, 1, -1, -1, -1, 1, -1, 1, 1, -1],
  }

  for (const [name, steps] of Object.entries(runs)) {
    it(`flips each record in full before the next, at the usual pace (${name})`, () => {
      const { lifts, inFlight, dropped, minGap, waited, left, slots } = flipInTurn(steps)
      expect(left).toBe(0)
      expect(lifts).toHaveLength(steps.length)
      expect(inFlight).toBe(1)
      for (const { frames } of lifts) expect(Math.abs(frames - FLIP_SECONDS * 60)).toBeLessThanOrEqual(1)
      // A sleeve is about 0.9 slots thick, so records closer than that pass through each other.
      expect(minGap).toBeGreaterThan(0.9)
      expect(waited).toBe(0)
      expect(dropped).toBe(0)
      for (const slot of slots) expect([slot.lift, slot.slot]).toEqual([null, slot.offset])
    })
  }

  it('keeps every flip clear of the others when sped up, taking less time', () => {
    for (const speed of [1.5, 2, 4]) {
      for (const steps of Object.values(runs)) {
        const { lifts, minGap, waited, slots } = flipInTurn(steps, 45, FLIP_SECONDS / speed)
        for (const { frames } of lifts) expect(Math.abs(frames - FLIP_SECONDS / speed * 60)).toBeLessThanOrEqual(1)
        expect(minGap).toBeGreaterThan(0.9)
        expect(waited).toBe(0)
        for (const slot of slots) expect([slot.lift, slot.slot]).toEqual([null, slot.offset])
      }
    }
  })

  it('picks every record up from the very end of the stack', () => {
    for (const steps of Object.values(runs)) {
      const { lifts } = flipInTurn(steps)
      lifts.forEach(({ from }, i) => {
        const end = steps[i]! > 0 ? 0 : CRATE_SLOTS
        expect(Math.abs(Math.min(from, CRATE_SLOTS) - end)).toBeLessThan(1e-6)
      })
    }
  })
})

describe('speeding up while a key is held', () => {
  it('starts at the usual pace and smoothly picks up to half as fast again after three seconds', () => {
    expect(heldSpeed(0)).toBe(1)
    expect(heldSpeed(HELD_RAMP_SECONDS)).toBe(HELD_MAX_SPEED)
    expect(heldSpeed(10)).toBe(HELD_MAX_SPEED)
    expect(FLIP_SECONDS / HELD_MAX_SPEED).toBeCloseTo(0.533)
    let last = 1
    let step = 0
    for (let held = 0.1; held <= 3; held += 0.1) {
      const speed = heldSpeed(held)
      expect(speed).toBeGreaterThanOrEqual(last)
      // Gathering speed gently at first, and easing into the most it allows.
      if (held < 0.3 || held > 2.7) expect(speed - last).toBeLessThan(0.05)
      step = Math.max(step, speed - last)
      last = speed
    }
    expect(step).toBeLessThan(0.1)
  })
})

describe('crate window', () => {
  it('keeps the whole of a small collection loaded', () => {
    expect(crateWindow(12, 3).map(({ index }) => index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2])
  })

  it('keeps the visible records and the recently flipped ones of a large collection', () => {
    const window = crateWindow(500, 10)
    expect(window[0]).toEqual({ index: 10, offset: 0 })
    expect(window.some(({ offset }) => offset === CRATE_SLOTS)).toBe(true)
    expect(window.at(-1)).toEqual({ index: 9, offset: 499 })
    expect(window.length).toBeLessThan(50)
  })
})
