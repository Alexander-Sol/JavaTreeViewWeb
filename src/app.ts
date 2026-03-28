import { Viewport } from './renderers/viewport'
import { HeatmapRenderer } from './renderers/heatmapRenderer'
import { DendrogramRenderer } from './renderers/dendrogramRenderer'
import { ProteinRenderer } from './renderers/proteinRenderer'
import { collectProteinSegmentsFromGenes, detectProteinStructureFormat, extractProteinPosition } from './renderers/proteinStructure'
import { ColorScale, COLOR_SCHEMES } from './color/colorScale'
import { Tooltip } from './ui/tooltip'
import { computeSelectionRange } from './ui/selectionManager'
import { getGeneModificationColor } from './ui/modColors'
import { buildSubsetModel } from './model/dataModel'
import {
  loadFromFiles,
  loadFromUrls,
  fetchSampleList,
  getSampleUrls,
} from './ui/fileLoader'
import type { DataModel, PeptideRow } from './model/types'

const ZOOM_FACTOR = 1.25
const MOD_FILTER_ALL = '__ALL__'
const MOD_FILTER_MODIFIED = '__MODIFIED__'
const MOD_FILTER_HIDE_UNMODIFIED = '__HIDE_UNMODIFIED__'

export class App {
  private viewport = new Viewport()
  private colorScale = new ColorScale(COLOR_SCHEMES.YellowBlue, 3)
  private model: DataModel | null = null
  private baseModel: DataModel | null = null
  private detailModel: DataModel | null = null
  private modFilter = MOD_FILTER_ALL

  // Renderers
  private heatmapRenderer!: HeatmapRenderer
  private geneTreeRenderer!: DendrogramRenderer
  private arrayTreeRenderer!: DendrogramRenderer
  private detailViewport = new Viewport()
  private detailHeatmapRenderer!: HeatmapRenderer
  private detailGeneTreeRenderer!: DendrogramRenderer
  private detailArrayTreeRenderer!: DendrogramRenderer
  private proteinRenderer!: ProteinRenderer

  // UI elements
  private tooltip!: Tooltip
  private statusBar!: HTMLElement
  private viewerWorkspace!: HTMLElement
  private viewerGrid!: HTMLElement
  private detailPane!: HTMLElement
  private annotationPane!: HTMLElement
  private proteinPane!: HTMLElement
  private proteinViewportEl!: HTMLElement
  private proteinTitle!: HTMLElement
  private proteinMessage!: HTMLElement
  private detailGrid!: HTMLElement
  private detailTitle!: HTMLElement
  private annotationTitle!: HTMLElement
  private emptyState!: HTMLElement
  private geneLabelsEl!: HTMLElement
  private sampleLabelsEl!: HTMLElement
  private detailGeneLabelsEl!: HTMLElement
  private detailSampleLabelsEl!: HTMLElement
  private annotationListEl!: HTMLElement
  private heatmapCanvas!: HTMLCanvasElement
  private geneTreeCanvas!: HTMLCanvasElement
  private arrayTreeCanvas!: HTMLCanvasElement
  private detailHeatmapCanvas!: HTMLCanvasElement
  private detailGeneTreeCanvas!: HTMLCanvasElement
  private detailArrayTreeCanvas!: HTMLCanvasElement
  private geneTreeCell!: HTMLElement
  private arrayTreeCell!: HTMLElement
  private detailGeneTreeCell!: HTMLElement
  private detailArrayTreeCell!: HTMLElement
  private detailHeatmapCell!: HTMLElement

  // Pan state
  private isPanning = false
  private panStart = { x: 0, y: 0, gOff: 0, sOff: 0 }
  private mouseDownPos: { x: number; y: number } | null = null

  // Selection state: [lo, hi] indices, null when nothing selected
  private geneSelection: [number, number] | null = null
  private sampleSelection: [number, number] | null = null
  private selectedGeneNodeId: string | null = null
  private selectedSampleNodeId: string | null = null
  private detailSelectedGeneIndex: number | null = null

  // Persistent DOM elements for selection bands (created once)
  private geneBandEl!: HTMLElement
  private sampleBandEl!: HTMLElement
  private detailGeneBandEl!: HTMLElement

  // Set to true when a new dataset is loaded; handleResize() will call
  // fitAll() the first time it sees non-zero canvas dimensions.
  private pendingFit = false
  private pendingDetailFit = false
  private loadedProteinUrl: string | null = null
  private currentFilename = 'dataset'
  private currentProteinUrl?: string

  // ResizeObserver
  private resizeObserver!: ResizeObserver

  constructor(_container: HTMLElement) {
    this.initElements()
    this.initRenderers()
    this.initControls()
    this.initDropZone()
    this.initPanZoom()
    this.initLabelSelection()
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
    this.viewerWorkspace = q<HTMLElement>('#viewer-workspace')
    this.viewerGrid = q<HTMLElement>('#viewer-grid')
    this.detailPane = q<HTMLElement>('#detail-pane')
    this.annotationPane = q<HTMLElement>('#annotation-pane')
    this.proteinPane = q<HTMLElement>('#protein-pane')
    this.proteinViewportEl = q<HTMLElement>('#protein-viewport')
    this.proteinTitle = q<HTMLElement>('#protein-title')
    this.proteinMessage = q<HTMLElement>('#protein-message')
    this.detailGrid = q<HTMLElement>('#detail-grid')
    this.detailTitle = q<HTMLElement>('#detail-title')
    this.annotationTitle = q<HTMLElement>('#annotation-title')
    this.emptyState = q<HTMLElement>('#empty-state')
    this.geneLabelsEl = q<HTMLElement>('#gene-labels')
    this.sampleLabelsEl = q<HTMLElement>('#sample-labels')
    this.detailGeneLabelsEl = q<HTMLElement>('#detail-gene-labels')
    this.detailSampleLabelsEl = q<HTMLElement>('#detail-sample-labels')
    this.annotationListEl = q<HTMLElement>('#annotation-list')
    this.detailHeatmapCanvas = q<HTMLCanvasElement>('#detail-heatmap-canvas')
    this.detailGeneTreeCanvas = q<HTMLCanvasElement>('#detail-gene-tree-canvas')
    this.detailArrayTreeCanvas = q<HTMLCanvasElement>('#detail-array-tree-canvas')
    this.detailGeneTreeCell = q<HTMLElement>('#detail-gene-tree-cell')
    this.detailArrayTreeCell = q<HTMLElement>('#detail-array-tree-cell')
    this.detailHeatmapCell = q<HTMLElement>('#detail-heatmap-cell')

    // Create persistent selection band elements
    const heatmapCell = q<HTMLElement>('#heatmap-cell')
    this.geneBandEl = document.createElement('div')
    this.geneBandEl.className = 'selection-band'
    this.geneBandEl.dataset['axis'] = 'gene'
    this.geneBandEl.classList.add('hidden')
    heatmapCell.appendChild(this.geneBandEl)

    this.sampleBandEl = document.createElement('div')
    this.sampleBandEl.className = 'selection-band'
    this.sampleBandEl.dataset['axis'] = 'sample'
    this.sampleBandEl.classList.add('hidden')
    heatmapCell.appendChild(this.sampleBandEl)

    this.detailGeneBandEl = document.createElement('div')
    this.detailGeneBandEl.className = 'selection-band detail-selection-band'
    this.detailGeneBandEl.dataset['axis'] = 'gene'
    this.detailGeneBandEl.classList.add('hidden')
    this.detailHeatmapCell.appendChild(this.detailGeneBandEl)
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
    this.detailHeatmapRenderer = new HeatmapRenderer(
      this.detailHeatmapCanvas,
      this.colorScale,
      this.detailViewport,
    )
    this.detailGeneTreeRenderer = new DendrogramRenderer(
      this.detailGeneTreeCanvas,
      'left',
      this.detailViewport,
    )
    this.detailArrayTreeRenderer = new DendrogramRenderer(
      this.detailArrayTreeCanvas,
      'top',
      this.detailViewport,
    )
    this.proteinRenderer = new ProteinRenderer(this.proteinViewportEl)

    // Labels and selection bands update whenever viewport changes
    this.viewport.onChange(() => {
      this.updateLabels()
      this.updateSelectionBands()
    })
    this.detailViewport.onChange(() => {
      this.updateDetailLabels()
      this.updateDetailSelectionBand()
    })
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
      this.detailHeatmapRenderer.setColorScale(this.colorScale)
      this.updateLabels()
      this.updateDetailLabels()
    })

    // Contrast slider
    const slider = document.getElementById('contrast-slider') as HTMLInputElement
    const display = document.getElementById('contrast-display')!
    const syncContrast = () => {
      const val = parseFloat(slider.value)
      this.colorScale.setContrast(val)
      display.textContent = val.toFixed(1)
      this.heatmapRenderer.render()
      this.detailHeatmapRenderer.render()
    }
    slider.addEventListener('input', syncContrast)

    const modFilterEl = document.getElementById('mod-filter') as HTMLSelectElement
    modFilterEl.addEventListener('change', () => {
      this.modFilter = modFilterEl.value
      this.applyCurrentFilter()
    })

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

    document.getElementById('detail-close')!.addEventListener('click', () => {
      this.clearSelection()
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

    // Drag to pan / click to select row
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this.mouseDownPos = { x: e.clientX, y: e.clientY }
      this.isPanning = false
      this.panStart = {
        x: e.clientX,
        y: e.clientY,
        gOff: this.viewport.genes.offset,
        sOff: this.viewport.samples.offset,
      }
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDownPos) {
        this.handleHover(e)
        return
      }
      const dx = Math.abs(e.clientX - this.mouseDownPos.x)
      const dy = Math.abs(e.clientY - this.mouseDownPos.y)
      // Start panning once the mouse moves more than 4px
      if (!this.isPanning && (dx > 4 || dy > 4)) {
        this.isPanning = true
        canvas.style.cursor = 'grabbing'
      }
      if (this.isPanning) {
        const ddx = e.clientX - this.panStart.x
        const ddy = e.clientY - this.panStart.y
        this.viewport.genes.setOffset(
          this.panStart.gOff - ddy / this.viewport.genes.scale,
        )
        this.viewport.samples.setOffset(
          this.panStart.sOff - ddx / this.viewport.samples.scale,
        )
        this.viewport.notify()
      }
    })

    window.addEventListener('mouseup', (e) => {
      if (!this.mouseDownPos) return
      const wasPan = this.isPanning
      this.isPanning = false
      canvas.style.cursor = 'crosshair'
      this.mouseDownPos = null

      if (wasPan) return  // drag → don't treat as click

      // Clean click on heatmap: clear selection
      this.clearSelection()
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
        this.selectedGeneNodeId = node.id
        this.geneTreeRenderer.setSelectedNodeId(node.id)
        this.setGeneSelection(node.minIndex, node.maxIndex)
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
        this.selectedSampleNodeId = node.id
        this.arrayTreeRenderer.setSelectedNodeId(node.id)
        this.setSampleSelection(node.minIndex, node.maxIndex)
      }
    })
  }

  private initResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(this.viewerWorkspace)
    this.resizeObserver.observe(this.detailPane)
    this.resizeObserver.observe(this.annotationPane)
    this.resizeObserver.observe(this.proteinPane)
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
      const { cdtUrl, gtrUrl, atrUrl, proteinUrl } = getSampleUrls(sample)
      this.setStatus(`Loading ${sample.label}…`)
      const { model, filename } = await loadFromUrls(cdtUrl, gtrUrl, atrUrl)
      this.resetBaseModel(model)
      await this.applyModel(model, filename, proteinUrl)
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`)
    }
  }

  private async loadFiles(files: FileList): Promise<void> {
    try {
      this.setStatus('Loading…')
      const { model, filename } = await loadFromFiles(files)
      this.resetBaseModel(model)
      await this.applyModel(model, filename)
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`)
    }
  }

  private async applyModel(model: DataModel, filename: string, proteinUrl?: string): Promise<void> {
    if (this.modFilter === MOD_FILTER_ALL || this.baseModel === null) this.baseModel = model
    this.currentFilename = filename
    this.currentProteinUrl = proteinUrl
    this.populateModificationFilter(this.baseModel)
    this.model = model
    this.detailModel = null
    this.geneSelection = null
    this.sampleSelection = null
    this.selectedGeneNodeId = null
    this.selectedSampleNodeId = null

    // Show/hide tree panels — update CSS grid track sizes so empty tracks collapse
    const hasGeneTree = model.geneTree !== null
    const hasArrayTree = model.arrayTree !== null
    // Columns: gene-labels | gene-tree (collapses when absent) | heatmap
    this.configureGridTracks(
      this.viewerGrid,
      this.geneTreeCell,
      this.arrayTreeCell,
      hasGeneTree,
      hasArrayTree,
    )
    this.viewerWorkspace.classList.remove('show-detail')
    this.detailPane.classList.add('hidden')
    this.annotationPane.classList.add('hidden')
    if (proteinUrl) {
      this.proteinPane.classList.remove('hidden')
      this.viewerWorkspace.classList.add('has-protein')
    } else {
      this.proteinPane.classList.add('hidden')
      this.viewerWorkspace.classList.remove('has-protein')
    }
    this.detailSelectedGeneIndex = null
    this.geneTreeRenderer.setSelectedNodeId(null)
    this.arrayTreeRenderer.setSelectedNodeId(null)
    this.detailGeneTreeRenderer.setSelectedNodeId(null)
    this.detailArrayTreeRenderer.setSelectedNodeId(null)

    // Tell the viewport how many items exist so fitToSize() can compute the scale
    this.viewport.genes.setCount(model.genes.length)
    this.viewport.samples.setCount(model.sampleNames.length)

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
    this.viewerWorkspace.classList.remove('hidden')

    if (proteinUrl) await this.ensureProteinStructure(proteinUrl)
    await this.updateProteinHighlights()

    // Mark that we need to fit once the canvases have non-zero dimensions.
    // handleResize() (called by ResizeObserver or the rAF below) will trigger
    // fitAll() the first time it sees a valid canvas size.
    this.pendingFit = true
    requestAnimationFrame(() => this.handleResize())

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
  // Selection
  // ============================================================

  private setGeneSelection(lo: number, hi: number): void {
    this.geneSelection = [lo, hi]
    this.updateSelectionBands()
    this.updateDetailView()
    void this.updateProteinHighlights()
  }

  private setSampleSelection(lo: number, hi: number): void {
    this.sampleSelection = [lo, hi]
    this.updateSelectionBands()
    this.updateDetailView()
    void this.updateProteinHighlights()
  }

  private clearSelection(): void {
    this.geneSelection = null
    this.sampleSelection = null
    this.selectedGeneNodeId = null
    this.selectedSampleNodeId = null
    this.geneTreeRenderer.setSelectedNodeId(null)
    this.arrayTreeRenderer.setSelectedNodeId(null)
    this.updateSelectionBands()
    this.hideDetailView()
    void this.updateProteinHighlights()
  }

  private updateSelectionBands(): void {
    if (this.geneSelection) {
      const [lo, hi] = this.geneSelection
      const y0 = this.viewport.genes.indexToPixel(lo)
      const y1 = this.viewport.genes.indexToPixel(hi + 1)
      this.geneBandEl.style.top = `${y0}px`
      this.geneBandEl.style.height = `${Math.max(1, y1 - y0)}px`
      this.geneBandEl.classList.remove('hidden')
    } else {
      this.geneBandEl.classList.add('hidden')
    }

    if (this.sampleSelection) {
      const [lo, hi] = this.sampleSelection
      const x0 = this.viewport.samples.indexToPixel(lo)
      const x1 = this.viewport.samples.indexToPixel(hi + 1)
      this.sampleBandEl.style.left = `${x0}px`
      this.sampleBandEl.style.width = `${Math.max(1, x1 - x0)}px`
      this.sampleBandEl.classList.remove('hidden')
    } else {
      this.sampleBandEl.classList.add('hidden')
    }
  }

  private updateDetailView(): void {
    if (!this.model || (!this.geneSelection && !this.sampleSelection)) {
      this.hideDetailView()
      return
    }

    this.detailSelectedGeneIndex = null
    const detailModel = buildSubsetModel(this.model, this.geneSelection, this.sampleSelection)
    this.detailModel = detailModel

    this.configureGridTracks(
      this.detailGrid,
      this.detailGeneTreeCell,
      this.detailArrayTreeCell,
      detailModel.geneTree !== null,
      detailModel.arrayTree !== null,
    )

    this.detailViewport.genes.setCount(detailModel.genes.length)
    this.detailViewport.samples.setCount(detailModel.sampleNames.length)
    this.detailHeatmapRenderer.setModel(detailModel)
    this.detailGeneTreeRenderer.setTree(detailModel.geneTree, detailModel.geneTreeCorrMin)
    this.detailArrayTreeRenderer.setTree(detailModel.arrayTree, detailModel.arrayTreeCorrMin)
    this.detailGeneTreeRenderer.setSelectedNodeId(
      this.geneSelection && detailModel.geneTree ? detailModel.geneTree.id : null,
    )
    this.detailArrayTreeRenderer.setSelectedNodeId(
      this.sampleSelection && detailModel.arrayTree ? detailModel.arrayTree.id : null,
    )
    this.detailTitle.textContent = this.makeDetailTitle(detailModel)
    this.detailPane.classList.remove('hidden')
    this.annotationTitle.textContent = `${detailModel.genes.length} genes`
    this.renderAnnotationList(detailModel)
    this.annotationPane.classList.remove('hidden')
    this.viewerWorkspace.classList.add('show-detail')
    this.pendingDetailFit = true
    requestAnimationFrame(() => this.handleResize())
  }

  private hideDetailView(): void {
    this.detailModel = null
    this.pendingDetailFit = false
    this.detailPane.classList.add('hidden')
    this.annotationPane.classList.add('hidden')
    this.viewerWorkspace.classList.remove('show-detail')
    this.detailSelectedGeneIndex = null
    this.detailGeneLabelsEl.innerHTML = ''
    this.detailSampleLabelsEl.innerHTML = ''
    this.annotationListEl.innerHTML = ''
    this.detailGeneTreeRenderer.setSelectedNodeId(null)
    this.detailArrayTreeRenderer.setSelectedNodeId(null)
    this.updateDetailSelectionBand()
    void this.updateProteinHighlights()
  }

  private makeDetailTitle(model: DataModel): string {
    return `${model.genes.length} genes x ${model.sampleNames.length} samples`
  }

  private renderAnnotationList(model: DataModel): void {
    this.annotationListEl.innerHTML = ''

    const frag = document.createDocumentFragment()
    model.genes.forEach((gene, index) => {
      const item = document.createElement('div')
      item.className = 'annotation-item'
      if (this.isPeptideRow(gene)) {
        const modColor = getGeneModificationColor(gene)
        item.classList.add('has-mod-color')
        item.style.setProperty('--annotation-mod-color', modColor)
      }
      item.dataset['geneIndex'] = String(index)
      if (index === this.detailSelectedGeneIndex) item.classList.add('is-active')
      item.addEventListener('click', () => this.selectDetailGene(index))

      const geneEl = document.createElement('div')
      geneEl.className = 'annotation-gene'
      geneEl.textContent = gene.yorf || gene.gid || 'Unknown gene'

      const nameEl = document.createElement('div')
      nameEl.className = 'annotation-name annotation-mod'
      nameEl.textContent = this.makeGenePrimaryLabel(gene)

      const metaEl = document.createElement('div')
      metaEl.className = 'annotation-meta'
      metaEl.textContent = this.makeGeneSecondaryLabel(gene)

      const sequenceEl = document.createElement('div')
      sequenceEl.className = 'annotation-sequence'
      sequenceEl.textContent = this.isPeptideRow(gene) && gene.baseSequence
        ? `Sequence: ${gene.baseSequence}`
        : 'Sequence unavailable'

      item.appendChild(geneEl)
      item.appendChild(nameEl)
      item.appendChild(metaEl)
      item.appendChild(sequenceEl)
      frag.appendChild(item)
    })

    this.annotationListEl.appendChild(frag)
  }

  private selectDetailGene(index: number): void {
    if (!this.detailModel || index < 0 || index >= this.detailModel.genes.length) return
    this.detailSelectedGeneIndex = index
    this.renderAnnotationList(this.detailModel)
    this.updateDetailSelectionBand()
    void this.updateProteinHighlights()
  }

  private async ensureProteinStructure(url: string): Promise<void> {
    if (this.loadedProteinUrl === url) return

    const label = url.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'structure'
    const format = detectProteinStructureFormat(url) ?? 'pdb'
    await this.proteinRenderer.loadStructureFromUrl(url, format, label)
    this.loadedProteinUrl = url
    this.proteinTitle.textContent = 'Mol* Protein View'
  }

  private async updateProteinHighlights(): Promise<void> {
    if (this.proteinPane.classList.contains('hidden')) return
    if (this.loadedProteinUrl === null) {
      this.proteinMessage.textContent = 'Loading structure…'
      return
    }

    const genes = this.getProteinHighlightGenes()
    const segments = collectProteinSegmentsFromGenes(genes)
    await this.proteinRenderer.setHighlightedSegments(segments)

    if (this.detailSelectedGeneIndex !== null && this.detailModel) {
      this.proteinMessage.textContent = segments.length > 0
        ? this.describeProteinSegments(segments)
        : 'Selected row has no peptide residue metadata.'
      return
    }

    if (this.geneSelection && this.detailModel) {
      this.proteinMessage.textContent = segments.length > 0
        ? this.describeProteinSegments(segments)
        : 'Selected cluster has no peptide residue metadata.'
      return
    }

    this.proteinMessage.textContent = 'Select peptide-bearing rows or clusters to highlight residues.'
  }

  private getProteinHighlightGenes(): DataModel['genes'] {
    if (this.detailSelectedGeneIndex !== null && this.detailModel) {
      const gene = this.detailModel.genes[this.detailSelectedGeneIndex]
      return gene ? [gene] : []
    }

    if (this.geneSelection && this.detailModel) return this.detailModel.genes
    return []
  }

  private describeProteinSegments(segments: ReturnType<typeof collectProteinSegmentsFromGenes>): string {
    const residueCount = segments.reduce((sum, segment) => sum + (segment.end - segment.start + 1), 0)
    return `${segments.length} segment${segments.length === 1 ? '' : 's'} highlighted across ${residueCount} residues.`
  }

  private applyCurrentFilter(): void {
    if (!this.baseModel) return

    const sourceModel = this.baseModel
    const filteredGenes = sourceModel.genes.filter((gene) => this.matchesModificationFilter(gene))
    const nextModel: DataModel = {
      ...sourceModel,
      genes: filteredGenes,
    }
    nextModel.expressionMatrix = filteredGenes.map((gene) => [...gene.values])
    this.model = nextModel
    void this.applyModel(nextModel, this.currentFilename, this.currentProteinUrl)
  }

  private resetBaseModel(model: DataModel): void {
    this.baseModel = model
  }

  private populateModificationFilter(model: DataModel): void {
    const select = document.getElementById('mod-filter') as HTMLSelectElement
    const dynamicOptions = model.modificationCategories.filter((value) =>
      ![MOD_FILTER_ALL, MOD_FILTER_MODIFIED, MOD_FILTER_HIDE_UNMODIFIED].includes(value),
    )
    select.innerHTML = ''
    const options: Array<[string, string]> = [
      [MOD_FILTER_ALL, 'All peptides'],
      ['Unmodified', 'Unmodified only'],
      [MOD_FILTER_MODIFIED, 'Modified only'],
      [MOD_FILTER_HIDE_UNMODIFIED, 'Hide unmodified'],
      ...dynamicOptions.map((value): [string, string] => [value, value]),
    ]
    options.forEach(([value, label]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      select.appendChild(option)
    })
    select.value = this.modFilter
  }

  private matchesModificationFilter(gene: DataModel['genes'][number]): boolean {
    if (this.modFilter === MOD_FILTER_ALL) return true
    if (!this.isPeptideRow(gene)) return this.modFilter === 'Unmodified'
    if (this.modFilter === 'Unmodified') return !gene.modifications.hasModification
    if (this.modFilter === MOD_FILTER_MODIFIED) return gene.modifications.hasModification
    if (this.modFilter === MOD_FILTER_HIDE_UNMODIFIED) return gene.modifications.hasModification
    return gene.modifications.category === this.modFilter || gene.modifications.modifications.some((mod) => mod.normalizedName === this.modFilter)
  }

  private makeGenePrimaryLabel(gene: DataModel['genes'][number]): string {
    const position = this.makeProteinPositionLabel(gene)
    return this.isPeptideRow(gene) ? `${position} · ${gene.modifications.displayLabel}` : position
  }

  private makeGeneSecondaryLabel(gene: DataModel['genes'][number]): string {
    const title = gene.name || gene.annotation || gene.yorf || 'Unknown peptide'
    return this.isPeptideRow(gene) ? `${title} · ${gene.modifications.category}` : title
  }

  private makeProteinPositionLabel(gene: DataModel['genes'][number]): string {
    const position = extractProteinPosition(gene)
    if (position) return `${position.start}-${position.end}`
    return this.isPeptideRow(gene) ? (gene.baseSequence ?? gene.yorf) : gene.yorf
  }

  private isPeptideRow(gene: DataModel['genes'][number]): gene is PeptideRow {
    return 'baseSequence' in gene && 'modifications' in gene && 'startPosition' in gene && 'endPosition' in gene
  }

  private updateDetailSelectionBand(): void {
    if (this.detailSelectedGeneIndex === null || !this.detailModel) {
      this.detailGeneBandEl.classList.add('hidden')
      return
    }

    const y0 = this.detailViewport.genes.indexToPixel(this.detailSelectedGeneIndex)
    const y1 = this.detailViewport.genes.indexToPixel(this.detailSelectedGeneIndex + 1)
    this.detailGeneBandEl.style.top = `${y0}px`
    this.detailGeneBandEl.style.height = `${Math.max(1, y1 - y0)}px`
    this.detailGeneBandEl.classList.remove('hidden')
  }

  // Drag-to-select on gene-labels panel (selects row range)
  // Drag-to-select on sample-labels panel (selects column range)
  private initLabelSelection(): void {
    const geneCell = document.getElementById('gene-labels-cell')!
    const sampleCell = document.querySelector<HTMLElement>('.cell-sample-labels')!

    this.initAxisDrag(geneCell, 'gene')
    this.initAxisDrag(sampleCell, 'sample')
  }

  private initAxisDrag(cell: HTMLElement, axis: 'gene' | 'sample'): void {
    let dragStart: number | null = null

    cell.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const rect = cell.getBoundingClientRect()
      dragStart = axis === 'gene' ? e.clientY - rect.top : e.clientX - rect.left
    })

    window.addEventListener('mousemove', (e) => {
      if (dragStart === null) return
      if (!this.model) return
      const rect = cell.getBoundingClientRect()
      const current = axis === 'gene' ? e.clientY - rect.top : e.clientX - rect.left
      const axisVp = axis === 'gene' ? this.viewport.genes : this.viewport.samples
      const count = axis === 'gene' ? this.model.genes.length : this.model.sampleNames.length
      const range = computeSelectionRange(dragStart, current, axisVp, count)
      if (range) {
        if (axis === 'gene') {
          this.selectedGeneNodeId = null
          this.geneTreeRenderer.setSelectedNodeId(null)
          this.setGeneSelection(range.lo, range.hi)
        } else {
          this.selectedSampleNodeId = null
          this.arrayTreeRenderer.setSelectedNodeId(null)
          this.setSampleSelection(range.lo, range.hi)
        }
      }
    })

    window.addEventListener('mouseup', (e) => {
      if (dragStart === null) return
      if (!this.model) {
        dragStart = null
        return
      }
      const rect = cell.getBoundingClientRect()
      const end = axis === 'gene' ? e.clientY - rect.top : e.clientX - rect.left
      const axisVp = axis === 'gene' ? this.viewport.genes : this.viewport.samples
      const count = axis === 'gene' ? this.model.genes.length : this.model.sampleNames.length
      const range = computeSelectionRange(dragStart, end, axisVp, count)
      if (range) {
        if (axis === 'gene') {
          this.selectedGeneNodeId = null
          this.geneTreeRenderer.setSelectedNodeId(null)
          this.setGeneSelection(range.lo, range.hi)
        } else {
          this.selectedSampleNodeId = null
          this.arrayTreeRenderer.setSelectedNodeId(null)
          this.setSampleSelection(range.lo, range.hi)
        }
      }
      dragStart = null
    })
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

  private updateDetailLabels(): void {
    if (!this.detailModel) return

    this.renderGeneLabelsInto(this.detailModel, this.detailViewport, this.detailGeneLabelsEl)
    this.renderSampleLabelsInto(this.detailModel, this.detailViewport, this.detailSampleLabelsEl)
  }

  private renderGeneLabelsInto(model: DataModel, viewport: Viewport, target: HTMLElement): void {
    const gAxis = viewport.genes
    const cellSize = gAxis.cellSize

    target.innerHTML = ''
    if (cellSize < 8) return

    const first = gAxis.firstVisible
    const last = gAxis.lastVisible
    const frag = document.createDocumentFragment()

    for (let i = first; i <= last; i++) {
      const gene = model.genes[i]
      if (!gene) continue

      const label = document.createElement('div')
      label.className = 'gene-label'
      label.textContent = this.makeGenePrimaryLabel(gene)
      label.title = `${this.makeGeneSecondaryLabel(gene)}${this.isPeptideRow(gene) && gene.baseSequence ? `\n${gene.baseSequence}` : ''}`
      if (this.isPeptideRow(gene)) label.style.color = getGeneModificationColor(gene)
      label.style.top = `${gAxis.indexToPixel(i + 0.5)}px`
      frag.appendChild(label)
    }

    target.appendChild(frag)
  }

  private renderSampleLabelsInto(model: DataModel, viewport: Viewport, target: HTMLElement): void {
    const sAxis = viewport.samples
    const cellSize = sAxis.cellSize

    target.innerHTML = ''
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
      label.style.left = `${sAxis.indexToPixel(i + 0.5)}px`
      frag.appendChild(label)
    }

    target.appendChild(frag)
  }

  private renderGeneLabels(): void {
    this.renderGeneLabelsInto(this.model!, this.viewport, this.geneLabelsEl)
  }

  private renderSampleLabels(): void {
    this.renderSampleLabelsInto(this.model!, this.viewport, this.sampleLabelsEl)
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
    this.resizeCanvas(this.detailHeatmapCanvas)
    this.resizeCanvas(this.detailGeneTreeCanvas)
    this.resizeCanvas(this.detailArrayTreeCanvas)

    const heatmapW = this.heatmapCanvas.width
    const heatmapH = this.heatmapCanvas.height

    if (heatmapW === 0 || heatmapH === 0) return  // layout not ready yet

    this.viewport.genes.setSize(heatmapH)
    this.viewport.samples.setSize(heatmapW)

    if (this.pendingFit) {
      this.pendingFit = false
      // fitAll calls notify() which re-renders everything, so return after.
      this.viewport.fitAll()
      return
    }

    this.heatmapRenderer.render()
    this.geneTreeRenderer.render()
    this.arrayTreeRenderer.render()
    this.updateLabels()

    if (this.detailModel) {
      const detailHeatmapW = this.detailHeatmapCanvas.width
      const detailHeatmapH = this.detailHeatmapCanvas.height
      if (detailHeatmapW > 0 && detailHeatmapH > 0) {
        this.detailViewport.genes.setSize(detailHeatmapH)
        this.detailViewport.samples.setSize(detailHeatmapW)
        if (this.pendingDetailFit) {
          this.pendingDetailFit = false
          this.detailViewport.fitAll()
        } else {
          this.detailHeatmapRenderer.render()
          this.detailGeneTreeRenderer.render()
          this.detailArrayTreeRenderer.render()
          this.updateDetailLabels()
        }
      }
    }
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

  private configureGridTracks(
    grid: HTMLElement,
    geneTreeCell: HTMLElement,
    arrayTreeCell: HTMLElement,
    hasGeneTree: boolean,
    hasArrayTree: boolean,
  ): void {
    grid.style.gridTemplateColumns =
      `var(--label-w) ${hasGeneTree ? 'var(--gene-tree-w)' : '0px'} 1fr`
    grid.style.gridTemplateRows =
      `var(--label-h) ${hasArrayTree ? 'var(--array-tree-h)' : '0px'} 1fr`
    geneTreeCell.style.display = hasGeneTree ? '' : 'none'
    arrayTreeCell.style.display = hasArrayTree ? '' : 'none'
  }
}
