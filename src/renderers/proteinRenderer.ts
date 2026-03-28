import { Viewer } from 'molstar/lib/apps/viewer/app'
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure'
import type { StructureComponentRef } from 'molstar/lib/mol-plugin-state/manager/structure/hierarchy-state'
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms'
import { StateSelection } from 'molstar/lib/mol-state'
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder'
import { Color } from 'molstar/lib/mol-util/color'
import type { ProteinSegment, ProteinStructureFormat } from './proteinStructure'
import { normalizeProteinSegments, prepareProteinStructureText } from './proteinStructure'

const DEFAULT_SEGMENT_COLOR = '#f4c145'
const OVERPAINT_TAG = 'jtv-protein-overpaint'

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
    const components = this.getCurrentStructureComponents(viewer)

    await this.clearOverpaint(viewer, components)
    selectionManager.clear()

    if (this.highlightedSegments.length === 0) return

    await this.applyOverpaint(viewer, components)
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

  private getCurrentStructureComponents(viewer: Viewer): StructureComponentRef[] {
    const grouped = viewer.plugin.managers.structure.hierarchy.currentComponentGroups.flat()
    if (grouped.length > 0) return grouped
    return viewer.plugin.managers.structure.hierarchy.current.structures.flatMap((structure) => structure.components)
  }

  private async clearOverpaint(viewer: Viewer, components: StructureComponentRef[]): Promise<void> {
    const state = viewer.plugin.state.data
    const update = state.build()

    for (const component of components) {
      for (const representation of component.representations) {
        const existing = state.select(
          StateSelection.Generators
            .ofTransformer(StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle, representation.cell.transform.ref)
            .withTag(OVERPAINT_TAG),
        )

        for (const cell of existing) update.delete(cell.transform.ref)
      }
    }

    await update.commit({ doNotUpdateCurrent: true })
  }

  private async applyOverpaint(viewer: Viewer, components: StructureComponentRef[]): Promise<void> {
    const state = viewer.plugin.state.data
    const update = state.build()

    for (const component of components) {
      for (const representation of component.representations) {
        const structure = representation.cell.obj?.data.sourceData
        if (!structure) continue

        const layers = buildOverpaintLayers(structure.root, this.highlightedSegments)
        if (layers.length === 0) continue

        update.to(representation.cell.transform.ref).apply(
          StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle,
          { layers },
          { tags: [OVERPAINT_TAG], state: { isGhost: true } },
        )
      }
    }

    await update.commit({ doNotUpdateCurrent: true })
  }
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

function groupSegmentsByColor(segments: ProteinSegment[]): Map<string, ProteinSegment[]> {
  const grouped = new Map<string, ProteinSegment[]>()

  for (const segment of segments) {
    const color = segment.color ?? DEFAULT_SEGMENT_COLOR
    const bucket = grouped.get(color)
    if (bucket) bucket.push(segment)
    else grouped.set(color, [segment])
  }

  return grouped
}

function getSegmentGroupLoci(structure: Structure, segments: ProteinSegment[]): StructureElement.Loci | null {
  const loci = StructureElement.Loci.fromExpression(
    structure,
    MS.struct.combinator.merge(segments.map(createSegmentExpression)),
  )

  return StructureElement.Loci.isEmpty(loci) ? null : loci
}

function buildOverpaintLayers(
  structure: Structure,
  segments: ProteinSegment[],
): Array<{ bundle: ReturnType<typeof StructureElement.Bundle.fromLoci>; color: Color; clear: false }> {
  const layers: Array<{ bundle: ReturnType<typeof StructureElement.Bundle.fromLoci>; color: Color; clear: false }> = []

  for (const [color, colorSegments] of groupSegmentsByColor(segments)) {
    const loci = getSegmentGroupLoci(structure, colorSegments)
    if (!loci) continue
    layers.push({
      bundle: StructureElement.Bundle.fromLoci(loci),
      color: Color.fromHexStyle(color),
      clear: false,
    })
  }

  return layers
}
