## Goal

Implement true multi-color peptide/residue highlighting in Mol* by adding persistent coloring layers instead of relying on the single global selection highlight color.

## Current State

- Repo: `JavaTreeViewWeb`
- Relevant files:
  - `src/renderers/proteinRenderer.ts`
  - `src/renderers/proteinStructure.ts`
  - `src/ui/modColors.ts`
  - `src/app.ts`
  - `src/model/types.ts`
- Current behavior:
  - Heatmap/annotation labels can be color-coded by modification category.
  - Protein highlight segments are collected from peptide rows and passed into Mol*.
  - Mol* currently uses selection highlighting only, which effectively supports one visible highlight color at a time.
  - Segment objects already carry `color` and `label` fields.

## Important Data Model Facts

- `PeptideRow` now extends `GeneRow` and contains peptide-only data:
  - `baseSequence`
  - `modifications`
  - `startPosition`
  - `endPosition`
- `GeneRow` no longer contains peptide-specific fields.
- Peptide rows are currently detected in `src/parsers/cdtParser.ts` only when the CDT contains exact `START` and `END` columns.
- `extractProteinPosition()` in `src/renderers/proteinStructure.ts` now primarily uses parsed `PeptideRow.startPosition` and `PeptideRow.endPosition`.

## Relevant Existing Logic

### Segment creation

- `collectProteinSegmentsFromGenes()` in `src/renderers/proteinStructure.ts`
  - skips non-peptide rows
  - builds `ProteinSegment[]`
  - includes:
    - `start`
    - `end`
    - optional `chainId`
    - `sequenceIdKind`
    - `color`
    - `label`

### Color source

- `getGeneModificationColor()` in `src/ui/modColors.ts`
  - deterministic palette mapping based on mod category/name

### Current Mol* renderer limitation

- `src/renderers/proteinRenderer.ts`
  - uses `selectionManager.fromSelectionQuery('set', ...)`
  - sets `canvas3d.renderer.highlightColor`
  - this is not enough for simultaneous multi-color highlighted segments

## What Needs To Happen

Implement Mol* overpaint layers so multiple peptide segments can be colored at once based on modification category.

Desired outcome:
- multiple selected peptide segments appear simultaneously on the structure
- each segment/residue region uses its own mod-derived color
- coloring persists as an actual representation layer, not just transient hover/selection highlight

## Likely Implementation Direction

Use Mol* overpaint helpers / representation transforms instead of selection highlight.

Previously investigated Mol* files/types in `node_modules`:
- `mol-plugin-state/helpers/structure-overpaint.d.ts`
- `mol-plugin-state/helpers/structure-overpaint.js`
- `mol-theme/overpaint.d.ts`
- `mol-plugin-state/manager/structure/hierarchy-state.d.ts`
- `mol-plugin-state/manager/structure/hierarchy.d.ts`

Relevant Mol* APIs discovered:
- `setStructureOverpaint(plugin, components, color, lociGetter, types?)`
- `clearStructureOverpaint(plugin, components, types?)`
- overpaint layers are applied per representation via `OverpaintStructureRepresentation3DFromBundle`

Important caveat from prior attempt:
- Mol* `Script` typing in this installed version expects `expression: string`, which made some direct script-based approaches awkward.
- A previous attempt to wire custom overpaint layers was reverted because it ran into typing/loci construction issues.
- Most likely the robust route is to build proper `StructureElement.Loci` / bundle layers from resolved segment selections, then apply them as overpaint bundles.

## Constraints / Known Bugs / Context

- There was a previous bug where peptide position parsing used metadata heuristics and produced mismatched positions; this was fixed by introducing `PeptideRow` parsing in `cdtParser`.
- Sequential filtering bug was fixed in `src/app.ts`: filtered views must always derive from the preserved `baseModel`, not from an already-filtered model.
- If touching filtering/view refresh code, preserve that fix.

## Tests Already Present

- `src/__tests__/proteinStructure.test.ts`
  - segment extraction
  - peptide position handling
- `src/__tests__/cdtParser.test.ts`
  - peptide row creation when `START`/`END` exist
- `src/__tests__/filtering.test.ts`
  - regression coverage for sequential mod filtering

There are currently no dedicated tests for Mol* overpaint behavior.

## Suggested Next Steps For New Thread

1. Read:
   - `src/renderers/proteinRenderer.ts`
   - `src/renderers/proteinStructure.ts`
   - `src/model/types.ts`
   - `src/ui/modColors.ts`
2. Inspect Mol* overpaint helper usage in installed package.
3. Implement a clean abstraction in `proteinRenderer` for:
   - clearing old color layers
   - grouping segments by color
   - turning each segment group into loci/bundle layers
   - applying overpaint to current structure representations
4. Preserve existing selection behavior only if useful for focus/selection UX; do not depend on global highlight color for final coloring.
5. Run:
   - `bun test`
   - `bun run typecheck`
   - `bun run build`

## Suggested Prompt For New Thread

"Read `agent_info/Molstar-Overpaint-Handoff.md` and implement true multi-color Mol* peptide/residue coloring using overpaint layers. Preserve the current peptide row position model and existing filter fix. Run tests, typecheck, and build when done."
