import { addSphere } from 'molstar/lib/mol-geo/geometry/mesh/builder/sphere'
import { Mesh } from 'molstar/lib/mol-geo/geometry/mesh/mesh'
import { MeshBuilder } from 'molstar/lib/mol-geo/geometry/mesh/mesh-builder'
import { Sphere3D } from 'molstar/lib/mol-math/geometry'
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra'
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure'
import { Shape } from 'molstar/lib/mol-model/shape'
import { Viewer } from 'molstar/lib/apps/viewer/app'
import { PluginStateObject as SO, PluginStateTransform } from 'molstar/lib/mol-plugin-state/objects'
import type { StructureComponentRef } from 'molstar/lib/mol-plugin-state/manager/structure/hierarchy-state'
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms'
import { StateSelection } from 'molstar/lib/mol-state'
import { Task } from 'molstar/lib/mol-task'
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition'
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder'
import { Color } from 'molstar/lib/mol-util/color'
import type { ProteinModificationMarker, ProteinSegment, ProteinStructureFormat } from './proteinStructure'
import { prepareProteinStructureText } from './proteinStructure'

const DEFAULT_MARKER_COLOR = '#f4c145'
const MARKER_RADIUS = 1.6
const MARKER_OFFSET = 1.75
const MARKER_JITTER = 0.9
const MARKER_DETAIL = 2
const MARKER_TAG = 'jtv-protein-mod-markers'
const MARKER_EMISSIVE = 0.35
const MARKER_BUMPINESS = 0.2
const SEGMENT_OVERPAINT_TAG = 'jtv-protein-segment-overpaint'
const SEGMENT_COLOR = '#67d5ff'

interface ProteinModificationMarker3D {
  center: Vec3
  color: Color
  label: string
}

const ProteinModificationMarkersShape = PluginStateTransform.BuiltIn({
  name: 'jtv-protein-modification-markers-shape',
  display: 'Protein Modification Markers',
  from: SO.Root,
  to: SO.Shape.Provider,
  params: {
    markers: PD.Value<ProteinModificationMarker3D[]>([], { isHidden: true }),
  },
})({
  canAutoUpdate: () => true,
  apply({ params }) {
    return Task.create('Protein Modification Markers', async () => new SO.Shape.Provider({
      label: 'Protein Modification Markers',
      data: params.markers,
      params: Mesh.Params,
      getShape: (_, data, __, prev) => buildMarkerShape(data, prev?.geometry),
      geometryUtils: Mesh.Utils,
    }, { label: 'Protein Modification Markers' }))
  },
})

export class ProteinRenderer {
  private viewer: Viewer | null = null
  private initPromise: Promise<Viewer> | null = null
  private loadVersion = 0
  private hasStructure = false
  private highlightedSegments: ProteinSegment[] = []
  private highlightedMarkers: ProteinModificationMarker[] = []

  constructor(private readonly container: HTMLElement) {}

  async loadStructureFromUrl(url: string, format: ProteinStructureFormat, label: string): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch structure: ${res.statusText}`)
    const text = await res.text()
    await this.loadStructure(text, format, label)
  }

  async loadStructure(text: string, format: ProteinStructureFormat, label: string): Promise<void> {
    const viewer = await this.getViewer()
    const currentLoad = ++this.loadVersion
    const pdbText = prepareProteinStructureText(text, format)

    await viewer.plugin.clear()
    await viewer.loadStructureFromData(pdbText, 'pdb', { dataLabel: label })

    if (currentLoad !== this.loadVersion) return

    this.hasStructure = true
    await this.applyVisuals()
  }

  async setHighlightedSegments(segments: ProteinSegment[]): Promise<void> {
    this.highlightedSegments = segments
    if (!this.hasStructure) return
    await this.applyVisuals()
  }

  async setModificationMarkers(markers: ProteinModificationMarker[]): Promise<void> {
    this.highlightedMarkers = markers
    if (!this.hasStructure) return
    await this.applyVisuals()
  }

  async clear(): Promise<void> {
    this.highlightedSegments = []
    this.highlightedMarkers = []
    this.hasStructure = false
    const viewer = await this.getViewer()
    await viewer.plugin.clear()
  }

  private async applyVisuals(): Promise<void> {
    const viewer = await this.getViewer()
    viewer.plugin.managers.structure.selection.clear()
    const components = this.getCurrentStructureComponents(viewer)
    await this.clearSegmentOverpaint(viewer, components)
    await this.clearMarkerShape(viewer)

    const structure = this.getCurrentStructure(viewer)
    if (!structure) return

    if (this.highlightedSegments.length > 0) {
      await this.applySegmentOverpaint(viewer, components, structure.root)
    }

    if (this.highlightedMarkers.length === 0) return

    const markers3d = resolveMarkerPositions(structure, this.highlightedMarkers)
    if (markers3d.length === 0) return

    const update = viewer.plugin.state.data.build()
    update
      .toRoot()
      .apply(ProteinModificationMarkersShape, { markers: markers3d }, { tags: [MARKER_TAG], state: { isGhost: true } })
      .apply(
        StateTransforms.Representation.ShapeRepresentation3D,
        {
          alpha: 1,
          emissive: MARKER_EMISSIVE,
          material: { metalness: 0, roughness: 0.45, bumpiness: MARKER_BUMPINESS },
        },
        { tags: [MARKER_TAG], state: { isGhost: true } },
      )
    await update.commit({ doNotUpdateCurrent: true })
  }

  private getCurrentStructureComponents(viewer: Viewer): StructureComponentRef[] {
    const grouped = viewer.plugin.managers.structure.hierarchy.currentComponentGroups.flat()
    if (grouped.length > 0) return grouped
    return viewer.plugin.managers.structure.hierarchy.current.structures.flatMap((structure) => structure.components)
  }

  private async clearSegmentOverpaint(viewer: Viewer, components: StructureComponentRef[]): Promise<void> {
    const state = viewer.plugin.state.data
    const update = state.build()

    for (const component of components) {
      for (const representation of component.representations) {
        const existing = state.select(
          StateSelection.Generators
            .ofTransformer(StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle, representation.cell.transform.ref)
            .withTag(SEGMENT_OVERPAINT_TAG),
        )

        for (const cell of existing) update.delete(cell.transform.ref)
      }
    }

    await update.commit({ doNotUpdateCurrent: true })
  }

  private async applySegmentOverpaint(viewer: Viewer, components: StructureComponentRef[], structure: Structure): Promise<void> {
    const loci = getSegmentsLoci(structure, this.highlightedSegments)
    if (!loci) return

    const bundle = StructureElement.Bundle.fromLoci(loci)
    const layers = [{ bundle, color: Color.fromHexStyle(SEGMENT_COLOR), clear: false as const }]
    const state = viewer.plugin.state.data
    const update = state.build()

    for (const component of components) {
      for (const representation of component.representations) {
        update.to(representation.cell.transform.ref).apply(
          StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle,
          { layers },
          { tags: [SEGMENT_OVERPAINT_TAG], state: { isGhost: true } },
        )
      }
    }

    await update.commit({ doNotUpdateCurrent: true })
  }

  private async clearMarkerShape(viewer: Viewer): Promise<void> {
    const state = viewer.plugin.state.data
    const update = state.build()
    const providers = state.select(StateSelection.Generators.ofTransformer(ProteinModificationMarkersShape).withTag(MARKER_TAG))
    for (const provider of providers) update.delete(provider.transform.ref)
    await update.commit({ doNotUpdateCurrent: true })
  }

  private getCurrentStructure(viewer: Viewer): Structure | null {
    return viewer.plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data ?? null
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

function buildMarkerShape(markers: ProteinModificationMarker3D[], oldMesh?: Mesh) {
  const mesh = MeshBuilder.createState(Math.max(256, markers.length * 128), Math.max(128, markers.length * 64), oldMesh)
  const bounds = Sphere3D()

  for (let i = 0; i < markers.length; i++) {
    mesh.currentGroup = i
    addSphere(mesh, markers[i]!.center, MARKER_RADIUS, MARKER_DETAIL)
    Sphere3D.expandBySphere(bounds, bounds, Sphere3D.create(markers[i]!.center, MARKER_RADIUS))
  }

  const geometry = MeshBuilder.getMesh(mesh)
  if (markers.length > 0) geometry.setBoundingSphere(bounds)

  return Shape.create(
    'Protein Modification Markers',
    markers,
    geometry,
    (groupId) => markers[groupId]?.color ?? Color.fromHexStyle(DEFAULT_MARKER_COLOR),
    () => 1,
    (groupId) => markers[groupId]?.label ?? 'Modification marker',
  )
}

function resolveMarkerPositions(structure: Structure, markers: ProteinModificationMarker[]): ProteinModificationMarker3D[] {
  const root = structure.root
  const structureCenter = Vec3.clone(root.boundary.sphere.center)
  const grouped = new Map<string, ProteinModificationMarker[]>()

  for (const marker of markers) {
    const key = `${marker.sequenceIdKind ?? 'auth'}:${marker.chainId ?? ''}:${marker.position}`
    const group = grouped.get(key)
    if (group) group.push(marker)
    else grouped.set(key, [marker])
  }

  const resolved: ProteinModificationMarker3D[] = []
  for (const group of grouped.values()) {
    const loci = getMarkerLoci(root, group[0]!)
    if (!loci) continue
    const residueCenter = Vec3.clone(StructureElement.Loci.getBoundary(loci).sphere.center)
    const outward = getOutwardDirection(residueCenter, structureCenter)
    const tangentA = getTangent(outward)
    const tangentB = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), outward, tangentA))

    for (let i = 0; i < group.length; i++) {
      const marker = group[i]!
      const angle = (Math.PI * 2 * i) / Math.max(group.length, 1)
      const radial = group.length > 1
        ? Vec3.add(
            Vec3(),
            Vec3.scale(Vec3(), tangentA, Math.cos(angle) * MARKER_JITTER),
            Vec3.scale(Vec3(), tangentB, Math.sin(angle) * MARKER_JITTER),
          )
        : Vec3()

      resolved.push({
        center: Vec3.add(
          Vec3(),
          Vec3.add(Vec3(), residueCenter, Vec3.scale(Vec3(), outward, MARKER_OFFSET)),
          radial,
        ),
        color: Color.fromHexStyle(marker.color ?? DEFAULT_MARKER_COLOR),
        label: marker.label ?? `Residue ${marker.position}`,
      })
    }
  }

  return resolved
}

function getSegmentsLoci(structure: Structure, segments: ProteinSegment[]): StructureElement.Loci | null {
  const loci = StructureElement.Loci.fromExpression(
    structure,
    MS.struct.combinator.merge(segments.map(createSegmentExpression)),
  )

  return StructureElement.Loci.isEmpty(loci) ? null : loci
}

function getMarkerLoci(structure: Structure, marker: ProteinModificationMarker): StructureElement.Loci | null {
  const loci = StructureElement.Loci.fromExpression(structure, createMarkerExpression(marker))
  return StructureElement.Loci.isEmpty(loci) ? null : loci
}

function createMarkerExpression(marker: ProteinModificationMarker) {
  const sequenceProperty = marker.sequenceIdKind === 'label' ? 'label_seq_id' : 'auth_seq_id'
  const params: {
    'residue-test': ReturnType<typeof MS.core.rel.eq>
    'chain-test'?: ReturnType<typeof MS.core.logic.or>
  } = {
    'residue-test': MS.core.rel.eq([MS.ammp(sequenceProperty), marker.position]),
  }

  if (marker.chainId) {
    params['chain-test'] = MS.core.logic.or([
      MS.core.rel.eq([MS.ammp('auth_asym_id'), marker.chainId]),
      MS.core.rel.eq([MS.ammp('label_asym_id'), marker.chainId]),
    ])
  }

  return MS.struct.generator.atomGroups(params)
}

function createSegmentExpression(segment: ProteinSegment) {
  const sequenceProperty = segment.sequenceIdKind === 'label' ? 'label_seq_id' : 'auth_seq_id'
  const params: {
    'residue-test': ReturnType<typeof MS.core.logic.and>
    'chain-test'?: ReturnType<typeof MS.core.logic.or>
  } = {
    'residue-test': MS.core.logic.and([
      MS.core.rel.gre([MS.ammp(sequenceProperty), segment.start]),
      MS.core.rel.lte([MS.ammp(sequenceProperty), segment.end]),
    ]),
  }

  if (segment.chainId) {
    params['chain-test'] = MS.core.logic.or([
      MS.core.rel.eq([MS.ammp('auth_asym_id'), segment.chainId]),
      MS.core.rel.eq([MS.ammp('label_asym_id'), segment.chainId]),
    ])
  }

  return MS.struct.generator.atomGroups(params)
}

function getOutwardDirection(point: Vec3, structureCenter: Vec3): Vec3 {
  const direction = Vec3.sub(Vec3(), point, structureCenter)
  if (Vec3.magnitude(direction) < 1e-3) return Vec3.create(0, 1, 0)
  return Vec3.normalize(direction, direction)
}

function getTangent(normal: Vec3): Vec3 {
  const fallback = Math.abs(normal[0] ?? 0) < 0.9 ? Vec3.create(1, 0, 0) : Vec3.create(0, 1, 0)
  const tangent = Vec3.cross(Vec3(), normal, fallback)
  if (Vec3.magnitude(tangent) < 1e-3) return Vec3.create(0, 0, 1)
  return Vec3.normalize(tangent, tangent)
}
