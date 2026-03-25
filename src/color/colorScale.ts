import type { ColorScheme, ColorSchemeName } from '../model/types'

// ============================================================
// Preset color schemes (from Java ColorPresets.java)
// ============================================================

export const COLOR_SCHEMES: Record<ColorSchemeName, ColorScheme> = {
  RedGreen: {
    name: 'RedGreen',
    upColor: [255, 0, 0],
    zeroColor: [0, 0, 0],
    downColor: [0, 255, 0],
    missingColor: [144, 144, 144],
  },
  YellowBlue: {
    name: 'YellowBlue',
    upColor: [254, 255, 0],
    zeroColor: [0, 0, 0],
    downColor: [27, 183, 229],
    missingColor: [144, 144, 144],
  },
}

// ============================================================
// ColorScale class
// ============================================================

/**
 * Maps expression values to RGBA colors using linear interpolation.
 *
 * Values >= +contrast → fully saturated upColor
 * Values <= -contrast → fully saturated downColor
 * Values in between   → linear lerp through zeroColor
 * null                → missingColor
 */
export class ColorScale {
  private scheme: ColorScheme
  private contrast: number

  constructor(scheme: ColorScheme, contrast: number) {
    this.scheme = scheme
    this.contrast = Math.max(contrast, 0.001)
  }

  setScheme(scheme: ColorScheme): void {
    this.scheme = scheme
  }

  setContrast(contrast: number): void {
    this.contrast = Math.max(contrast, 0.001)
  }

  getContrast(): number {
    return this.contrast
  }

  /** Returns [r, g, b, a] as 0–255 integers */
  getColor(value: number | null): [number, number, number, number] {
    if (value === null || !isFinite(value)) {
      const [r, g, b] = this.scheme.missingColor
      return [r!, g!, b!, 255]
    }

    const t = Math.min(Math.abs(value) / this.contrast, 1.0)
    const base = this.scheme.zeroColor
    const target = value >= 0 ? this.scheme.upColor : this.scheme.downColor

    const r = Math.round(lerp(base[0]!, target[0]!, t))
    const g = Math.round(lerp(base[1]!, target[1]!, t))
    const b = Math.round(lerp(base[2]!, target[2]!, t))

    return [r, g, b, 255]
  }

  /**
   * Returns a CSS rgb() string — useful for tooltip color swatches.
   */
  getCssColor(value: number | null): string {
    const [r, g, b] = this.getColor(value)
    return `rgb(${r},${g},${b})`
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
