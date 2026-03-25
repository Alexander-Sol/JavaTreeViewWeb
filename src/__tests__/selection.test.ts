import { describe, test, expect, beforeEach } from 'bun:test'
import { AxisViewport } from '../renderers/viewport'
import { pixelToItemIndex, computeSelectionRange } from '../ui/selectionManager'

// ============================================================
// AxisViewport coordinate math
// ============================================================

describe('AxisViewport coordinate math', () => {
  let vp: AxisViewport

  beforeEach(() => {
    vp = new AxisViewport()
    vp.init(10, 100) // 10 items, 100px → scale = 10px/item
  })

  test('indexToPixel(0) is 0 after fitToSize', () => {
    expect(vp.indexToPixel(0)).toBe(0)
  })

  test('indexToPixel maps end of last item to canvas size', () => {
    expect(vp.indexToPixel(10)).toBe(100)
  })

  test('indexToPixel and pixelToIndex are inverses for integer item boundaries', () => {
    for (const i of [0, 1, 5, 9, 10]) {
      expect(vp.pixelToIndex(vp.indexToPixel(i))).toBeCloseTo(i, 10)
    }
  })

  test('panning shifts items: after zoom-in + setOffset(3), item 3 is at pixel 0', () => {
    // Zoom in 2× so scale=20, maxOffset=5 — then panning is possible
    vp.zoomCenter(2)
    vp.setOffset(3)
    expect(vp.indexToPixel(3)).toBeCloseTo(0, 10)
  })

  test('pixelToIndex after pan returns offset-adjusted index', () => {
    // Zoom in 2× (scale=20, maxOffset=5) then pan to item 5
    vp.zoomCenter(2)
    vp.setOffset(5)
    expect(Math.floor(vp.pixelToIndex(0))).toBe(5)
    // pixel 100 → 100/20 + 5 = 10
    expect(Math.floor(vp.pixelToIndex(100))).toBe(10)
  })

  test('firstVisible and lastVisible span entire range when fitted', () => {
    expect(vp.firstVisible).toBe(0)
    expect(vp.lastVisible).toBe(9)
  })
})

// ============================================================
// pixelToItemIndex
// ============================================================

describe('pixelToItemIndex', () => {
  let vp: AxisViewport

  beforeEach(() => {
    vp = new AxisViewport()
    vp.init(10, 100) // scale = 10
  })

  test('pixel 0 → item 0', () => {
    expect(pixelToItemIndex(0, vp)).toBe(0)
  })

  test('pixel 9 → item 0 (within first cell)', () => {
    expect(pixelToItemIndex(9, vp)).toBe(0)
  })

  test('pixel 10 → item 1 (start of second cell)', () => {
    expect(pixelToItemIndex(10, vp)).toBe(1)
  })

  test('pixel 95 → item 9 (last cell)', () => {
    expect(pixelToItemIndex(95, vp)).toBe(9)
  })

  test('negative pixels return negative index (caller must clamp)', () => {
    expect(pixelToItemIndex(-5, vp)).toBeLessThan(0)
  })
})

// ============================================================
// computeSelectionRange — row (vertical) drag
// ============================================================

describe('computeSelectionRange — row drag', () => {
  let vp: AxisViewport

  beforeEach(() => {
    vp = new AxisViewport()
    vp.init(10, 100) // scale = 10
  })

  test('single click on first row gives [0, 0]', () => {
    expect(computeSelectionRange(5, 5, vp, 10)).toEqual({ lo: 0, hi: 0 })
  })

  test('single click on last row gives [9, 9]', () => {
    expect(computeSelectionRange(95, 95, vp, 10)).toEqual({ lo: 9, hi: 9 })
  })

  test('drag from row 2 to row 5 gives [2, 5]', () => {
    // row 2 starts at pixel 20, row 5 starts at pixel 50
    expect(computeSelectionRange(20, 59, vp, 10)).toEqual({ lo: 2, hi: 5 })
  })

  test('reversed drag (bottom to top) gives same range as forward', () => {
    expect(computeSelectionRange(59, 20, vp, 10)).toEqual({ lo: 2, hi: 5 })
  })

  test('drag from above top clamps lo to 0', () => {
    const range = computeSelectionRange(-30, 35, vp, 10)
    expect(range).not.toBeNull()
    expect(range!.lo).toBe(0)
    expect(range!.hi).toBe(3)
  })

  test('drag beyond last row clamps hi to count - 1', () => {
    const range = computeSelectionRange(65, 150, vp, 10)
    expect(range).not.toBeNull()
    expect(range!.lo).toBe(6)
    expect(range!.hi).toBe(9)
  })

  test('entirely out-of-bounds drag (above canvas) returns null', () => {
    expect(computeSelectionRange(-100, -10, vp, 10)).toBeNull()
  })

  test('entirely out-of-bounds drag (below canvas) returns null', () => {
    expect(computeSelectionRange(110, 200, vp, 10)).toBeNull()
  })

  test('returns null when count is 0', () => {
    expect(computeSelectionRange(0, 50, vp, 0)).toBeNull()
  })
})

// ============================================================
// computeSelectionRange — column (horizontal) drag
// ============================================================

describe('computeSelectionRange — column drag', () => {
  let vp: AxisViewport

  beforeEach(() => {
    vp = new AxisViewport()
    vp.init(20, 200) // 20 samples, 200px → scale = 10px/sample
  })

  test('drag across all columns selects [0, 19]', () => {
    expect(computeSelectionRange(0, 199, vp, 20)).toEqual({ lo: 0, hi: 19 })
  })

  test('drag across middle columns gives correct range', () => {
    // sample 5 starts at px 50, sample 14 ends at px 150 (starts at 140)
    expect(computeSelectionRange(50, 149, vp, 20)).toEqual({ lo: 5, hi: 14 })
  })

  test('reversed horizontal drag gives same range', () => {
    expect(computeSelectionRange(149, 50, vp, 20)).toEqual({ lo: 5, hi: 14 })
  })
})

// ============================================================
// computeSelectionRange with panned viewport
// ============================================================

describe('computeSelectionRange with panned viewport', () => {
  test('correct range when viewport is scrolled', () => {
    const vp = new AxisViewport()
    vp.init(100, 100) // scale = 1px/item (all items fit, maxOffset=0)
    // Zoom in 2× to create panning room: scale=2, maxOffset=50
    vp.zoomCenter(2)
    vp.setOffset(50)  // scrolled so item 50 is at pixel 0

    // pixel 0 → item 50, pixel 10 → 10/2+50 = 55
    const range = computeSelectionRange(0, 10, vp, 100)
    expect(range).not.toBeNull()
    expect(range!.lo).toBe(50)
    expect(range!.hi).toBe(55)
  })
})
