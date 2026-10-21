/** Record radius as a fraction of the sleeve's width (a 12" record in its sleeve). */
export const RECORD_RADIUS = 0.475

/** How much of the record's diameter shows when it is pulled out of the sleeve. */
export const EXPOSED = 0.3

/** Width of the front stage relative to its height: the sleeve plus the part of the record pulled out. */
export const STAGE_ASPECT = 1 + RECORD_RADIUS * 2 * EXPOSED

export function columnsFor(width: number): number {
  if (width >= 860) return 5
  if (width >= 620) return 4
  if (width >= 420) return 3
  return 2
}
