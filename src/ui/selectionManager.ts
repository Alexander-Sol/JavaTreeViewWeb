import type { AxisViewport } from '../renderers/viewport'

/**
 * Convert a pixel offset on a canvas axis to an integer item index.
 */
export function pixelToItemIndex(pixel: number, axis: AxisViewport): number {
  return Math.floor(axis.pixelToIndex(pixel))
}

/**
 * Compute a selection range [lo, hi] from two pixel positions on the same axis.
 *
 * - Handles reversed drags (endPixel < startPixel)
 * - Clamps both ends to [0, count - 1]
 * - Returns null if the entire span falls outside [0, count - 1]
 */
export function computeSelectionRange(
  startPixel: number,
  endPixel: number,
  axis: AxisViewport,
  count: number,
): { lo: number; hi: number } | null {
  if (count <= 0) return null

  const a = pixelToItemIndex(startPixel, axis)
  const b = pixelToItemIndex(endPixel, axis)

  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(count - 1, Math.max(a, b))

  if (lo > hi) return null
  return { lo, hi }
}
