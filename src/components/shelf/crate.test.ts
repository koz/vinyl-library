import { describe, expect, it } from 'vitest'
import {
  CRATE_SLOTS,
  FLIP_SECONDS,
  QUICK_FLIP_SECONDS,
  crateSleevePose,
  crateWindow,
  liftPose,
  moveSlot,
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

  it('settles immediately with reduced motion', () => {
    const count = 5
    const slots = stack(count)
    flip(slots, count, -1)
    expect(settleSlots(slots, count, 1 / 60, true)).toBe(false)
    expect(slots.map((slot) => slot.slot)).toEqual([1, 2, 3, 4, 0])
  })
})

describe('flipping steadily', () => {
  // Mirrors the scene: the window of records kept loaded, and the pace of flips that follow one
  // another. Like a held key: one flip, a pause before the key repeats, then a flip every
  // `interval` milliseconds until `holdMs`.
  function hold(direction: number, interval: number, holdMs: number, repeatDelay = 500) {
    const count = 45
    let front = 0
    let lastFlip = -Infinity
    let quickUntil = 0
    const slots = new Map<number, CrateSlot>()
    const lifts: number[] = []
    let inFlight = 0
    let dropped = 0
    // The closest any two records come, in slots, where they could touch: standing records in
    // view, and a record low enough to be among them while it is lifted out or lowered in.
    let minGap = Infinity
    const visible = (slot: number) => Math.min(slot, CRATE_SLOTS)
    const measure = () => {
      const standing = [...slots.values()].filter((slot) => !slot.lift && slot.slot < CRATE_SLOTS)
        .map((slot) => slot.slot).sort((a, b) => a - b)
      for (let i = 1; i < standing.length; i++) minGap = Math.min(minGap, standing[i]! - standing[i - 1]!)
      for (const slot of slots.values()) {
        const lift = slot.lift
        if (!lift) continue
        const to = lift.land ?? lift.to
        const pose = liftPose(slotPose(lift.from, count), slotPose(to, count), lift.t)
        if (pose.y > 1) continue
        const at = visible(lift.t < 0.5 ? lift.from : to)
        if (at >= CRATE_SLOTS) continue
        for (const other of standing) minGap = Math.min(minGap, Math.abs(other - at))
      }
    }
    const arrange = (now: number, step: number) => {
      if (step) {
        if (now - lastFlip < FLIP_SECONDS * 1000) quickUntil = now + QUICK_FLIP_SECONDS * 1000
        lastFlip = now
      }
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
        if (!lifting && slot.lift) lifts.push(slot.lift.from)
      }
    }
    arrange(0, 0)
    let nextFlip = 0
    for (let frame = 0; frame < (holdMs + 1500) * 60 / 1000; frame++) {
      const now = frame * 1000 / 60
      if (now >= nextFlip && now < holdMs) {
        nextFlip = nextFlip === 0 ? repeatDelay : nextFlip + interval
        front = (front + direction + count) % count
        arrange(now, direction)
      }
      settleSlots(slots.values(), count, 1 / 60, false, now < quickUntil)
      measure()
      inFlight = Math.max(inFlight, [...slots.values()].filter((slot) => slot.lift).length)
    }
    return { lifts, inFlight, dropped, minGap, slots: [...slots.values()] }
  }

  for (const direction of [1, -1]) {
    it(`never lowers or shuffles one record into another (${direction > 0 ? 'down' : 'up'})`, () => {
      // A sleeve is about 0.9 slots thick, so records closer than that pass through each other.
      for (const [interval, holdMs, repeatDelay] of [[200, 1, 500], [200, 3000, 500], [200, 3000, 200]]) {
        expect(hold(direction, interval!, holdMs!, repeatDelay).minGap).toBeGreaterThan(0.9)
      }
    })
  }

  it('never leaves records stuck out of place, even flipping as fast as the wheel allows', () => {
    for (const direction of [1, -1]) {
      const { dropped, slots } = hold(direction, 200, 3000, 200)
      expect(dropped).toBe(0)
      for (const slot of slots) expect([slot.lift, slot.slot]).toEqual([null, slot.offset])
    }
  })

  for (const direction of [1, -1]) {
    it(`keeps the front filled while an arrow key is held (${direction > 0 ? 'down' : 'up'})`, () => {
      const { lifts, inFlight, dropped, slots } = hold(direction, 200, 3000)
      expect(lifts.length).toBeGreaterThan(12)
      // Every record is picked up from the end of the stack, not from deeper and deeper inside it.
      const end = direction > 0 ? 0 : 44
      for (const from of lifts) expect(Math.abs(Math.min(from, CRATE_SLOTS) - Math.min(end, CRATE_SLOTS))).toBeLessThan(0.5)
      // No record disappears mid-air, and everything comes to rest afterwards.
      expect(dropped).toBe(0)
      // Records coming over the top may wait a moment for room, but stay well within the 8 the
      // crate keeps loaded.
      expect(inFlight).toBeLessThanOrEqual(6)
      for (const slot of slots) expect([slot.lift, slot.slot]).toEqual([null, slot.offset])
    })
  }
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
