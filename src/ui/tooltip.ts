import type { DataModel } from '../model/types'
import type { ColorScale } from '../color/colorScale'

export class Tooltip {
  private el: HTMLElement

  constructor(el: HTMLElement) {
    this.el = el
  }

  show(
    model: DataModel,
    colorScale: ColorScale,
    geneIdx: number,
    sampleIdx: number,
    clientX: number,
    clientY: number,
  ): void {
    const gene = model.genes[geneIdx]
    const sample = model.sampleNames[sampleIdx]
    const value = model.expressionMatrix[geneIdx]?.[sampleIdx] ?? null

    if (!gene || sample === undefined) {
      this.hide()
      return
    }

    const valStr = value !== null ? value.toFixed(3) : 'missing'
    const swatchColor = colorScale.getCssColor(value)

    this.el.innerHTML = `
      <div class="tooltip-gene">${escHtml(gene.yorf)}${gene.name ? ' — ' + escHtml(gene.name.trim()) : ''}</div>
      <div class="tooltip-sample">${escHtml(sample)}</div>
      <div class="tooltip-value">
        <span class="tooltip-swatch" style="background:${swatchColor}"></span>
        ${valStr}
      </div>
    `

    // Position near cursor, keeping within viewport
    const w = this.el.offsetWidth || 200
    const h = this.el.offsetHeight || 80
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = clientX + 14 + w > vw ? clientX - w - 10 : clientX + 14
    const y = clientY + 14 + h > vh ? clientY - h - 10 : clientY + 14

    this.el.style.left = `${x}px`
    this.el.style.top = `${y}px`
    this.el.classList.remove('hidden')
  }

  hide(): void {
    this.el.classList.add('hidden')
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
