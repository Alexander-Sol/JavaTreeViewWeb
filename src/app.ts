import { Viewport } from './renderers/viewport'
import { HeatmapRenderer } from './renderers/heatmapRenderer'
import { DendrogramRenderer } from './renderers/dendrogramRenderer'
import { ColorScale, COLOR_SCHEMES } from './color/colorScale'
import { Tooltip } from './ui/tooltip'
import {
  loadFromFiles,
  loadFromUrls,
  fetchSampleList,
  getSampleUrls,
} from './ui/fileLoader'
import type { DataModel } from './model/types'

const ZOOM_FACTOR = 1.25

export class App {
  private viewport = new Viewport()
  private colorScale = new ColorScale(COLOR_SCHEMES.YellowBlue, 3)
  private model: DataModel | null = null

  // Renderers
  private heatmapRenderer!: HeatmapRenderer
  private geneTreeRenderer!: DendrogramRenderer
  private arrayTreeRenderer!: DendrogramRenderer

  // UI elements
  private tooltip!: Tooltip
  private statusBar!: HTMLElement
  private viewerGrid!: HTMLElement
  private emptyState!: HTMLElement
  private geneLabelsEl!: HTMLElement
  private sampleLabelsEl!: HTMLElement
  private heatmapCanvas!: HTMLCanvasElement
  private geneTreeCanvas!: HTMLCanvasElement
  private arrayTreeCanvas!: HTMLCanvasElement
  private geneTreeCell!: HTMLElement
  private arrayTreeCell!: HTMLElement

  // Pan state
  private isPanning = false
  private panStart = { x: 0, y: 0, gOff: 0, sOff: 0 }

  // ResizeObserver
  private resizeObserver!: ResizeObserver

  constructor(_container: HTMLElement) {
    this.initElements()
    this.initRenderers()
    this.initControls()
    this.initDropZone()
    this.initPanZoom()
    this.initResizeObserver()
    this.loadSampleList()
  }

  // ============================================================
  // Initialization
  // ============================================================

  private initElements(): void {
    const q = <T extends Element>(sel: string) => {
      const el = document.querySelector<T>(sel)
      if (!el) throw new Error(`Missing element: ${sel}`)
      return el
    }

    this.heatmapCanvas = q<HTMLCanvasElement>('#heatmap-canvas')
    this.geneTreeCanvas = q<HTMLCanvasElement>('#gene-tree-canvas')
    this.arrayTreeCanvas = q<HTMLCanvasElement>('#array-tree-canvas')
    this.geneTreeCell = q<HTMLElement>('.cell-gene-tree')
    this.arrayTreeCell = q<HTMLElement>('.cell-array-tree')
    this.tooltip = new Tooltip(q<HTMLElement>('#tooltip'))
    this.statusBar = q<HTMLElement>('#status-bar')
    this.viewerGrid = q<HTMLElement>('#viewer-grid')
    this.emptyState = q<HTMLElement>('#empty-state')
    this.geneLabelsEl = q<HTMLElement>('#gene-labels')
    this.sampleLabelsEl = q<HTMLElement>('#sample-labels')
  }

  private initRenderers(): void {
    this.heatmapRenderer = new HeatmapRenderer(
      this.heatmapCanvas,
      this.colorScale,
      this.viewport,
    )
    this.geneTreeRenderer = new DendrogramRenderer(
      this.geneTreeCanvas,
      'left',
      this.viewport,
    )
    this.arrayTreeRenderer = new DendrogramRenderer(
      this.arrayTreeCanvas,
      'top',
      this.viewport,
    )

    // Labels update whenever viewport changes
    this.viewport.onChange(() => this.updateLabels())
  }

  private initControls(): void {
    // Load button + file input
    const loadBtn = document.getElementById('load-btn')!
    const fileInput = document.getElementById('file-input') as HTMLInputElement
    loadBtn.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      if (fileInput.files?.length) {
        await this.loadFiles(fileInput.files)
        fileInput.value = ''
      }
    })

    // Sample dataset dropdown
    const sampleSelect = document.getElementById('sample-select') as HTMLSelectElement
    sampleSelect.addEventListener('change', async () => {
      const name = sampleSelect.value
      if (!name) return
      sampleSelect.value = ''
      await this.loadSampleByName(name)
    })

    // Color scheme
    const colorSchemeEl = document.getElementById('color-scheme') as HTMLSelectElement
    colorSchemeEl.addEventListener('change', () => {
      const name = colorSchemeEl.value as keyof typeof COLOR_SCHEMES
      this.colorScale.setScheme(COLOR_SCHEMES[name])
      this.heatmapRenderer.setColorScale(this.colorScale)
      this.updateLabels()
    })

    // Contrast slider
    const slider = document.getElementById('contrast-slider') as HTMLInputElement
    const display = document.getElementById('contrast-display')!
    const syncContrast = () => {
      const val = parseFloat(slider.value)
      this.colorScale.setContrast(val)
      display.textContent = val.toFixed(1)
      this.heatmapRenderer.render()
    }
    slider.addEventListener('input', syncContrast)

    // Zoom buttons
    document.getElementById('zoom-fit')!.addEventListener('click', () => {
      this.viewport.fitAll()
    })
    document.getElementById('zoom-in-y')!.addEventListener('click', () => {
      this.viewport.genes.zoomCenter(ZOOM_FACTOR)
      this.viewport.notify()
    })
    document.getElementById('zoom-out-y')!.addEventListener('click', () => {
      this.viewport.genes.zoomCenter(1 / ZOOM_FACTOR)
      this.viewport.notify()
    })
    document.getElementById('zoom-in-x')!.addEventListener('click', () => {
      this.viewport.samples.zoomCenter(ZOOM_FACTOR)
      this.viewport.notify()
    })
    document.getElementById('zoom-out-x')!.addEventListener('click', () => {
      this.viewport.samples.zoomCenter(1 / ZOOM_FACTOR)
      this.viewport.notify()
    })
  }

  private initDropZone(): void {
    const container = document.getElementById('viewer-container')!
    const overlay = document.getElementById('drop-overlay')!

    container.addEventListener('dragover', (e) => {
      e.preventDefault()
      overlay.classList.remove('hidden')
    })
    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget as Node)) {
        overlay.classList.add('hidden')
      }
    })
    container.addEventListener('drop', async (e) => {
      e.preventDefault()
      overlay.classList.add('hidden')
      if (e.dataTransfer?.files.length) {
        await this.loadFiles(e.dataTransfer.files)
      }
    })
  }

  private initPanZoom(): void {
    const canvas = this.heatmapCanvas

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR

      if (e.ctrlKey || e.metaKey) {
        // Zoom both axes
        this.viewport.genes.zoomAround(py, factor)
        this.viewport.samples.zoomAround(px, factor)
      } else if (e.shiftKey) {
        this.viewport.samples.zoomAround(px, factor)
      } else {
        this.viewport.genes.zoomAround(py, factor)
      }
      this.viewport.notify()
    }, { passive: false })

    // Drag to pan
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this.isPanning = true
      this.panStart = {
        x: e.clientX,
        y: e.clientY,
        gOff: this.viewport.genes.offset,
        sOff: this.viewport.samples.offset,
      }
      canvas.style.cursor = 'grabbing'
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) {
        this.handleHover(e)
        return
      }
      const dx = e.clientX - this.panStart.x
      const dy = e.clientY - this.panStart.y
      this.viewport.genes.setOffset(
        this.panStart.gOff - dy / this.viewport.genes.scale,
      )
      this.viewport.samples.setOffset(
        this.panStart.sOff - dx / this.viewport.samples.scale,
      )
      this.viewport.notify()
    })

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false
        canvas.style.cursor = 'crosshair'
      }
    })

    canvas.style.cursor = 'crosshair'

    // Mouse leave heatmap → hide tooltip
    canvas.addEventListener('mouseleave', () => this.tooltip.hide())

    // Click on gene tree → select subtree
    this.geneTreeCanvas.addEventListener('click', (e) => {
      if (!this.model?.geneTree) return
      const rect = this.geneTreeCanvas.getBoundingClientRect()
      const node = this.geneTreeRenderer.findNearestNode(
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      if (node) {
        this.geneTreeRenderer.setSelectedNodeId(node.id)
        this.renderSelectionBand(node.minIndex, node.maxIndex, 'gene')
      }
    })

    // Click on array tree → select subtree
    this.arrayTreeCanvas.addEventListener('click', (e) => {
      if (!this.model?.arrayTree) return
      const rect = this.arrayTreeCanvas.getBoundingClientRect()
      const node = this.arrayTreeRenderer.findNearestNode(
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      if (node) {
        this.arrayTreeRenderer.setSelectedNodeId(node.id)
        this.renderSelectionBand(node.minIndex, node.maxIndex, 'sample')
      }
    })

    // Click heatmap to deselect
    canvas.addEventListener('click', () => {
      this.geneTreeRenderer.setSelectedNodeId(null)
      this.arrayTreeRenderer.setSelectedNodeId(null)
      this.clearSelectionBands()
    })
  }

  private initResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    const grid = document.getElementById('viewer-grid')!
    this.resizeObserver.observe(grid)
  }

  // ============================================================
  // Loading
  // ============================================================

  private async loadSampleList(): Promise<void> {
    try {
      const samples = await fetchSampleList()
      const select = document.getElementById('sample-select') as HTMLSelectElement
      for (const s of samples) {
        const opt = document.createElement('option')
        opt.value = s.name
        opt.textContent = s.label
        select.appendChild(opt)
      }
    } catch {
      // Sample list is best-effort; don't crash
    }
  }

  private async loadSampleByName(name: string): Promise<void> {
    try {
      const samples = await fetchSampleList()
      const sample = samples.find((s) => s.name === name)
      if (!sample) return
      const { cdtUrl, gtrUrl, atrUrl } = getSampleUrls(sample)
      this.setStatus(`Loading ${sample.label}…`)
      const { model, filename } = await loadFromUrls(cdtUrl, gtrUrl, atrUrl)
      this.applyModel(model, filename)
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`)
    }
  }

  private async loadFiles(files: FileList): Promise<void> {
    try {
      this.setStatus('Loading…')
      const { model, filename } = await loadFromFiles(files)
      this.applyModel(model, filename)
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`)
    }
  }

  private applyModel(model: DataModel, filename: string): void {
    this.model = model

    // Show/hide tree panels
    const hasGeneTree = model.geneTree !== null
    const hasArrayTree = model.arrayTree !== null
    this.geneTreeCell.style.display = hasGeneTree ? '' : 'none'
    this.arrayTreeCell.style.display = hasArrayTree ? '' : 'none'

    // Auto-set contrast to 4× mean absolute value (matching Java default)
    const autoContrast = Math.max(0.5, model.valueMeanAbsolute * 4)
    this.colorScale.setContrast(autoContrast)
    const slider = document.getElementById('contrast-slider') as HTMLInputElement
    const display = document.getElementById('contrast-display')!
    slider.value = String(Math.min(6, autoContrast).toFixed(1))
    display.textContent = autoContrast.toFixed(1)

    // Pass data to renderers
    this.heatmapRenderer.setModel(model)
    this.geneTreeRenderer.setTree(model.geneTree, model.geneTreeCorrMin)
    this.arrayTreeRenderer.setTree(model.arrayTree, model.arrayTreeCorrMin)

    // Show viewer
    this.emptyState.classList.add('hidden')
    this.viewerGrid.classList.remove('hidden')

    // Fit after a tick (DOM needs to lay out first)
    requestAnimationFrame(() => {
      this.handleResize()
      this.viewport.fitAll()
    })

    const treeInfo = [
      hasGeneTree ? 'gene tree' : null,
      hasArrayTree ? 'array tree' : null,
    ]
      .filter(Boolean)
      .join(' + ')

    this.setStatus(
      `${filename} — ${model.genes.length} genes × ${model.sampleNames.length} samples` +
        (treeInfo ? ` (${treeInfo})` : ''),
    )
  }

  // ============================================================
  // Hover / tooltip
  // ============================================================

  private handleHover(e: MouseEvent): void {
    if (!this.model) return

    const rect = this.heatmapCanvas.getBoundingClientRect()
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top

    if (canvasX < 0 || canvasY < 0 || canvasX > rect.width || canvasY > rect.height) {
      this.tooltip.hide()
      return
    }

    const geneIdx = Math.floor(this.viewport.genes.pixelToIndex(canvasY))
    const sampleIdx = Math.floor(this.viewport.samples.pixelToIndex(canvasX))

    if (
      geneIdx < 0 ||
      geneIdx >= this.model.genes.length ||
      sampleIdx < 0 ||
      sampleIdx >= this.model.sampleNames.length
    ) {
      this.tooltip.hide()
      return
    }

    this.tooltip.show(this.model, this.colorScale, geneIdx, sampleIdx, e.clientX, e.clientY)
  }

  // ============================================================
  // Selection bands
  // ============================================================

  private renderSelectionBand(
    minIdx: number,
    maxIdx: number,
    axis: 'gene' | 'sample',
  ): void {
    this.clearSelectionBands()
    const band = document.createElement('div')
    band.className = 'selection-band'
    band.dataset['axis'] = axis

    const heatmapCell = document.getElementById('heatmap-cell')!

    if (axis === 'gene') {
      const y0 = this.viewport.genes.indexToPixel(minIdx)
      const y1 = this.viewport.genes.indexToPixel(maxIdx + 1)
      band.style.left = '0'
      band.style.right = '0'
      band.style.top = `${y0}px`
      band.style.height = `${Math.max(1, y1 - y0)}px`
    } else {
      const x0 = this.viewport.samples.indexToPixel(minIdx)
      const x1 = this.viewport.samples.indexToPixel(maxIdx + 1)
      band.style.top = '0'
      band.style.bottom = '0'
      band.style.left = `${x0}px`
      band.style.width = `${Math.max(1, x1 - x0)}px`
    }

    heatmapCell.appendChild(band)

    // Update band on viewport change
    this.viewport.onChange(() => {
      if (!band.isConnected) return
      if (axis === 'gene') {
        const y0 = this.viewport.genes.indexToPixel(minIdx)
        const y1 = this.viewport.genes.indexToPixel(maxIdx + 1)
        band.style.top = `${y0}px`
        band.style.height = `${Math.max(1, y1 - y0)}px`
      } else {
        const x0 = this.viewport.samples.indexToPixel(minIdx)
        const x1 = this.viewport.samples.indexToPixel(maxIdx + 1)
        band.style.left = `${x0}px`
        band.style.width = `${Math.max(1, x1 - x0)}px`
      }
    })
  }

  private clearSelectionBands(): void {
    const heatmapCell = document.getElementById('heatmap-cell')!
    heatmapCell.querySelectorAll('.selection-band').forEach((el) => el.remove())
  }

  // ============================================================
  // Labels
  // ============================================================

  private updateLabels(): void {
    if (!this.model) return

    // Gene labels (right of heatmap)
    this.renderGeneLabels()
    // Sample labels (below heatmap)
    this.renderSampleLabels()
  }

  private renderGeneLabels(): void {
    const model = this.model!
    const gAxis = this.viewport.genes
    const cellSize = gAxis.cellSize

    this.geneLabelsEl.innerHTML = ''
    if (cellSize < 8) return

    const first = gAxis.firstVisible
    const last = gAxis.lastVisible

    const frag = document.createDocumentFragment()
    for (let i = first; i <= last; i++) {
      const gene = model.genes[i]
      if (!gene) continue

      const label = document.createElement('div')
      label.className = 'gene-label'
      label.textContent = gene.yorf + (gene.name.trim() ? ' ' + gene.name.trim() : '')
      label.title = label.textContent
      const centerPx = gAxis.indexToPixel(i + 0.5)
      label.style.top = `${centerPx}px`
      frag.appendChild(label)
    }
    this.geneLabelsEl.appendChild(frag)
  }

  private renderSampleLabels(): void {
    const model = this.model!
    const sAxis = this.viewport.samples
    const cellSize = sAxis.cellSize

    this.sampleLabelsEl.innerHTML = ''
    if (cellSize < 8) return

    const first = sAxis.firstVisible
    const last = sAxis.lastVisible

    const frag = document.createDocumentFragment()
    for (let i = first; i <= last; i++) {
      const name = model.sampleNames[i]
      if (name === undefined) continue

      const label = document.createElement('div')
      label.className = 'sample-label'
      label.textContent = name.trim()
      label.title = name.trim()
      const centerPx = sAxis.indexToPixel(i + 0.5)
      label.style.left = `${centerPx}px`
      frag.appendChild(label)
    }
    this.sampleLabelsEl.appendChild(frag)
  }

  // ============================================================
  // Resize
  // ============================================================

  private handleResize(): void {
    if (!this.model) return

    // Resize all canvases to match their CSS-laid-out size
    this.resizeCanvas(this.heatmapCanvas)
    this.resizeCanvas(this.geneTreeCanvas)
    this.resizeCanvas(this.arrayTreeCanvas)

    // Update viewport available-pixel counts
    const heatmapW = this.heatmapCanvas.width
    const heatmapH = this.heatmapCanvas.height

    this.viewport.genes.setSize(heatmapH)
    this.viewport.samples.setSize(heatmapW)

    this.heatmapRenderer.render()
    this.geneTreeRenderer.render()
    this.arrayTreeRenderer.render()
    this.updateLabels()
  }

  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
  }

  private setStatus(msg: string): void {
    this.statusBar.textContent = msg
  }
}
