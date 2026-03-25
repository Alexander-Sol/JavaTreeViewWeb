import type { DataModel } from '../model/types'
import type { ColorScale } from '../color/colorScale'
import type { Viewport } from './viewport'

/**
 * HeatmapRenderer paints expression data onto a canvas using ImageData
 * (direct pixel buffer writes) for performance — avoids per-cell fillRect calls.
 */
export class HeatmapRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private model: DataModel | null = null
  private colorScale: ColorScale
  private viewport: Viewport
  private unsubscribe: (() => void) | null = null

  constructor(canvas: HTMLCanvasElement, colorScale: ColorScale, viewport: Viewport) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context from heatmap canvas')
    this.ctx = ctx
    this.colorScale = colorScale
    this.viewport = viewport

    this.unsubscribe = viewport.onChange(() => this.render())
  }

  setModel(model: DataModel): void {
    this.model = model
    this.render()
  }

  setColorScale(colorScale: ColorScale): void {
    this.colorScale = colorScale
    this.render()
  }

  /** Call when the canvas element has been resized (updates pixel dimensions) */
  resize(): void {
    const { offsetWidth: w, offsetHeight: h } = this.canvas
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.render()
  }

  render(): void {
    if (!this.model) return

    const { width, height } = this.canvas
    if (width === 0 || height === 0) return

    const gAxis = this.viewport.genes
    const sAxis = this.viewport.samples
    const matrix = this.model.expressionMatrix
    const nGenes = this.model.genes.length
    const nSamples = this.model.sampleNames.length

    // Determine visible index ranges (add 1 cell of margin)
    const firstGene = Math.max(0, Math.floor(gAxis.pixelToIndex(0)) - 1)
    const lastGene = Math.min(nGenes - 1, Math.ceil(gAxis.pixelToIndex(height)) + 1)
    const firstSample = Math.max(0, Math.floor(sAxis.pixelToIndex(0)) - 1)
    const lastSample = Math.min(nSamples - 1, Math.ceil(sAxis.pixelToIndex(width)) + 1)

    const imgData = this.ctx.createImageData(width, height)
    const data = imgData.data

    // Fill background with missing-data color
    const [mr, mg, mb] = this.colorScale.getColor(null)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = mr!
      data[i + 1] = mg!
      data[i + 2] = mb!
      data[i + 3] = 255
    }

    for (let gi = firstGene; gi <= lastGene; gi++) {
      const y0 = Math.round(gAxis.indexToPixel(gi))
      const y1 = Math.round(gAxis.indexToPixel(gi + 1))
      const py0 = Math.max(0, y0)
      const py1 = Math.min(height, y1)
      if (py0 >= py1) continue

      const geneRow = matrix[gi]
      if (!geneRow) continue

      for (let si = firstSample; si <= lastSample; si++) {
        const x0 = Math.round(sAxis.indexToPixel(si))
        const x1 = Math.round(sAxis.indexToPixel(si + 1))
        const px0 = Math.max(0, x0)
        const px1 = Math.min(width, x1)
        if (px0 >= px1) continue

        const val = geneRow[si] ?? null
        const [r, g, b] = this.colorScale.getColor(val)

        // Fill the pixel block for this cell
        for (let py = py0; py < py1; py++) {
          const rowStart = py * width
          for (let px = px0; px < px1; px++) {
            const i = (rowStart + px) * 4
            data[i] = r!
            data[i + 1] = g!
            data[i + 2] = b!
            // alpha already 255 from background fill
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0)
  }

  destroy(): void {
    this.unsubscribe?.()
  }
}
