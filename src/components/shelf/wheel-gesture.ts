// How far a scroll goes, in pixels, before it flips a record.
const WHEEL_STEP = 90

/**
 * Turns wheel events into flips: one once the scroll has gone far enough, then none until that
 * record has landed, so a trackpad swipe and its momentum flip a single record. Each call takes an
 * event's vertical scroll in pixels and whether a record is still flipping, and returns the flip
 * to make, if any.
 */
export function createWheelGesture() {
  let total = 0
  return (delta: number, flipping: boolean): number => {
    if (flipping) {
      total = 0
      return 0
    }
    if (Math.sign(delta) !== Math.sign(total)) total = 0
    total += delta
    if (Math.abs(total) < WHEEL_STEP) return 0
    total = 0
    return Math.sign(delta)
  }
}
