import { Viewer } from 'molstar/lib/apps/viewer/app'
import { StructureSelectionQuery } from 'molstar/lib/mol-plugin-state/helpers/structure-selection-query'
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder'
import type { ProteinSegment, ProteinStructureFormat } from './proteinStructure'
import { normalizeProteinSegments, prepareProteinStructureText } from './proteinStructure'

export class ProteinRenderer {
  private viewer: Viewer | null = null
  private initPromise: Promise<Viewer> | null = null
  private loadVersion = 0
  private hasStructure = false
  private highlightedSegments: ProteinSegment[] = []

  constructor(private readonly container: HTMLElement) {}

  async loadStructureFromUrl(
    url: string,
    format: ProteinStructureFormat,
    label: string,
  ): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch structure: ${res.statusText}`)
    const text = await res.text()
    await this.loadStructure(text, format, label)
  }

  async loadStructure(
    text: string,
    format: ProteinStructureFormat,
    label: string,
  ): Promise<void> {
    const viewer = await this.getViewer()
    const currentLoad = ++this.loadVersion
    const pdbText = prepareProteinStructureText(text, format)

    await viewer.plugin.clear()
    await viewer.loadStructureFromData(pdbText, 'pdb', { dataLabel: label })

    if (currentLoad !== this.loadVersion) return

    this.hasStructure = true
    await this.applyHighlights()
  }

  async setHighlightedSegments(segments: ProteinSegment[]): Promise<void> {
    this.highlightedSegments = normalizeProteinSegments(segments)
    if (!this.hasStructure) return
    await this.applyHighlights()
  }

  async clear(): Promise<void> {
    this.highlightedSegments = []
    this.hasStructure = false
    const viewer = await this.getViewer()
    await viewer.plugin.clear()
  }

  private async applyHighlights(): Promise<void> {
    const viewer = await this.getViewer()
    const selectionManager = viewer.plugin.managers.structure.selection
    selectionManager.clear()

    if (this.highlightedSegments.length === 0) return

    selectionManager.fromSelectionQuery('set', buildSegmentQuery(this.highlightedSegments), true)
  }

  private async getViewer(): Promise<Viewer> {
    if (this.viewer) return this.viewer
    if (!this.initPromise) {
      this.initPromise = Viewer.create(this.container, {
        layoutIsExpanded: false,
        layoutShowControls: false,
        layoutShowSequence: false,
        layoutShowLog: false,
        layoutShowLeftPanel: false,
        collapseLeftPanel: true,
        collapseRightPanel: true,
        viewportShowControls: false,
        viewportShowExpand: false,
        viewportShowSelectionMode: false,
        viewportShowAnimation: false,
        viewportShowScreenshotControls: false,
        viewportShowSettings: false,
        viewportShowTrajectoryControls: false,
        viewportBackgroundColor: '#101820',
      }).then((viewer) => {
        this.viewer = viewer
        return viewer
      })
    }

    return this.initPromise
  }
}

function buildSegmentQuery(segments: ProteinSegment[]) {
  return StructureSelectionQuery(
    'Selected peptide segments',
    MS.struct.combinator.merge(segments.map(createSegmentExpression)),
  )
}

function createSegmentExpression(segment: ProteinSegment) {
  const sequenceProperty = segment.sequenceIdKind === 'label' ? 'label_seq_id' : 'auth_seq_id'
  const residueTests = [
    MS.core.rel.gre([MS.ammp(sequenceProperty), segment.start]),
    MS.core.rel.lte([MS.ammp(sequenceProperty), segment.end]),
  ]

  const params: {
    'residue-test': ReturnType<typeof MS.core.logic.and>
    'chain-test'?: ReturnType<typeof MS.core.logic.or>
  } = {
    'residue-test': MS.core.logic.and(residueTests),
  }

  if (segment.chainId) {
    params['chain-test'] = MS.core.logic.or([
      MS.core.rel.eq([MS.ammp('auth_asym_id'), segment.chainId]),
      MS.core.rel.eq([MS.ammp('label_asym_id'), segment.chainId]),
    ])
  }

  return MS.struct.generator.atomGroups(params)
}
