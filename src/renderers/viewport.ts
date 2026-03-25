/**
 * AxisViewport manages the 1D coordinate transform for one axis (genes or samples).
 *
 * State:
 *   offset  — index of the first visible item (float, supports sub-index panning)
 *   scale   — pixels per item (zoom level)
 *   size    — canvas dimension in pixels for this axis
 *   count   — total number of items (genes or samples)
 */
export class AxisViewport {
  private _offset = 0
  private _scale = 16
  private _size = 0
  private _count = 0

  init(count: number, size: number): void {
    this._count = count
    this._size = size
    this.fitToSize()
  }

  /** Set canvas dimension (px) — called on resize */
  setSize(size: number): void {
    this._size = size
    this.clampOffset()
  }

  /** Set total item count */
  setCount(count: number): void {
    this._count = count
  }

  /** Fit all items into the available size */
  fitToSize(): void {
    if (this._count <= 0 || this._size <= 0) return
    this._scale = this._size / this._count
    this._offset = 0
  }

  // ---- Coordinate transforms ----

  /** Index (0-based) → pixel offset from canvas origin */
  indexToPixel(index: number): number {
    return (index - this._offset) * this._scale
  }

  /** Pixel offset → fractional index */
  pixelToIndex(pixel: number): number {
    return pixel / this._scale + this._offset
  }

  // ---- Zoom ----

  /**
   * Zoom around a focal pixel, keeping the item under the cursor stationary.
   * @param focalPixel  pixel position under the mouse
   * @param factor      >1 = zoom in, <1 = zoom out
   */
  zoomAround(focalPixel: number, factor: number): void {
    const focalIndex = this.pixelToIndex(focalPixel)
    this._scale = clamp(this._scale * factor, MIN_SCALE, MAX_SCALE)
    // Recompute offset so focalIndex stays at focalPixel
    this._offset = focalIndex - focalPixel / this._scale
    this.clampOffset()
  }

  /** Zoom around the center of the visible area */
  zoomCenter(factor: number): void {
    this.zoomAround(this._size / 2, factor)
  }

  // ---- Pan ----

  setOffset(offset: number): void {
    this._offset = offset
    this.clampOffset()
  }

  panByPixels(deltaPx: number): void {
    this._offset -= deltaPx / this._scale
    this.clampOffset()
  }

  // ---- Accessors ----

  get offset(): number { return this._offset }
  get scale(): number { return this._scale }
  get size(): number { return this._size }
  get count(): number { return this._count }

  /** Pixel size of one cell at current zoom */
  get cellSize(): number { return this._scale }

  /** Index of first fully-visible item */
  get firstVisible(): number { return Math.max(0, Math.floor(this._offset)) }

  /** Index of last fully-visible item */
  get lastVisible(): number {
    return Math.min(this._count - 1, Math.ceil(this.pixelToIndex(this._size)))
  }

  // ---- Internals ----

  private clampOffset(): void {
    if (this._count <= 0) { this._offset = 0; return }
    const maxOffset = Math.max(0, this._count - this._size / this._scale)
    this._offset = clamp(this._offset, 0, maxOffset)
  }
}

// ============================================================
// Viewport: owns both axes and notifies listeners on change
// ============================================================

type ChangeListener = () => void

export class Viewport {
  readonly genes: AxisViewport
  readonly samples: AxisViewport
  private listeners = new Set<ChangeListener>()

  constructor() {
    this.genes = new AxisViewport()
    this.samples = new AxisViewport()
  }

  /** Register a callback to be called whenever the viewport changes */
  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Notify all registered listeners that the viewport has changed */
  notify(): void {
    this.listeners.forEach((cb) => cb())
  }

  /** Fit both axes so the entire dataset is visible */
  fitAll(): void {
    this.genes.fitToSize()
    this.samples.fitToSize()
    this.notify()
  }
}

// ============================================================
// Constants
// ============================================================

const MIN_SCALE = 1   // 1 pixel per item (most zoomed out)
const MAX_SCALE = 80  // 80 pixels per item (most zoomed in)

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
