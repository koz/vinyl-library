import { describe, expect, it } from 'vitest'
import { FLIP_SECONDS } from './crate'
import { createWheelGesture } from './wheel-gesture'

type WheelEvent = { delta: number; time: number }

// A trackpad swipe, starting at `start` ms: the fingers speed up to `speed` pixels per event over
// a few frames, then lift, and the scroll carries on with momentum, dying away. Like the browser,
// deltas are whole pixels, 16ms apart.
function swipe(start: number, speed: number, direction = 1): WheelEvent[] {
  const deltas = [0.15, 0.4, 0.7, 0.95, 1, 0.9].map((part) => speed * part)
  let momentum = speed * 0.85
  while (momentum >= 0.5) {
    deltas.push(momentum)
    momentum *= 0.93
  }
  return deltas.map((delta, i) => ({ delta: Math.max(1, Math.round(delta)) * direction, time: start + i * 16 }))
}

const end = (events: WheelEvent[]) => events.at(-1)!.time

// Mirrors the crate: each flip starts on the next frame and keeps it busy until it lands.
function flips(events: WheelEvent[]): number[] {
  const gesture = createWheelGesture()
  const made: number[] = []
  let busyUntil = -Infinity
  for (const { delta, time } of events) {
    const step = gesture(delta, time < busyUntil)
    if (!step) continue
    made.push(step)
    busyUntil = time + 16 + FLIP_SECONDS * 1000
  }
  return made
}

describe('scrolling the crate', () => {
  it('flips one record per trackpad swipe, however hard, momentum and all', () => {
    for (const speed of [12, 30, 60, 120, 200]) {
      expect(flips(swipe(0, speed))).toEqual([1])
      expect(flips(swipe(0, speed, -1))).toEqual([-1])
    }
  })

  it('ignores a second swipe while the record is still flipping', () => {
    const first = swipe(0, 50).slice(0, 15)
    expect(flips([...first, ...swipe(end(first) + 16, 50)])).toEqual([1])
  })

  it('flips again for a swipe once the record has landed', () => {
    for (const gap of [0, 100, 600]) {
      const first = swipe(0, 50)
      expect(flips([...first, ...swipe(end(first) + 16 + gap, 50)])).toEqual([1, 1])
    }
  })

  it('flips the other way once the record has landed', () => {
    const first = swipe(0, 50)
    expect(flips([...first, ...swipe(end(first) + 16, 50, -1)])).toEqual([1, -1])
  })

  it('flips one record per mouse wheel notch, skipping notches made while it flips', () => {
    const notches = [0, 250, 500, 900, 1800].map((time) => ({ delta: 100, time }))
    expect(flips(notches)).toEqual([1, 1, 1])
  })

  it('leaves a slight nudge alone', () => {
    expect(flips(swipe(0, 4))).toEqual([])
  })
})
