# Modification Support TODO

## Goal

Add peptide modification awareness throughout the import, data model, filtering, labeling, and visualization pipeline.

## Status

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete

## Reference

- Use `/Users/Claude/Projects/AlsMotorNeuronAnalysis/Supplemental/CustomScripts.R` as the reference for modification parsing behavior and synonym handling.
- Ignore unrelated R-specific helper code in that file.

## Phase 1: Parsing and Data Model

### 1.1 Parse modification syntax during peptide loading

- [x] Implement modification parsing during peptide info loading.
- [x] Support embedded bracket annotations in sequences such as `PEPT[Mod category: Specific mod]IDEK`.
- [x] Put modification parsing in the `cdtParser` flow.

### 1.2 Normalize equivalent modification names

- [x] Handle modification synonym normalization so equivalent encodings map to the same internal modification.
- [x] Example target: `[Uniprot: Phosphothreonine]` and `[Common Biological: Phosphorylation on Threonine]` should resolve to the same modification.

### 1.3 Store modification info on rows

- [x] Store parsed modification data on each `GeneRow` object.
- [x] Include enough detail to support downstream labeling, filtering, annotation display, and structure coloring.

## Phase 2: Display and Annotation

### 2.1 Improve peptide labels

- [x] Replace raw peptide-sequence-first labels with labels that emphasize protein position and modification state.
- [x] Display each peptide label as a combination of its protein position and modification state.
- [x] Move the raw peptide sequence into annotation details and/or hover text instead of using it as the main label.

### 2.2 Visual encoding for modifications

- [x] Add options to color-code modifications in the annotation list.
- [x] Add options to color-code modifications on the Mol* protein structure display.

## Phase 3: Filtering

### 3.1 Filter peptides by modification category

- [x] Add filtering options for displayed peptides (heatmap rows) by modification category.
- [x] Support filtering out unmodified peptides.
- [x] Support showing only peptides matching a selected modification category, e.g. phosphorylated peptides.

## Suggested Implementation Order

1. Extract mod parsing and normalization rules from `CustomScripts.R`.
2. Add parsed modification data to `cdtParser` output and `GeneRow`.
3. Update peptide labeling and annotation/hover presentation.
4. Add heatmap filtering by modification category.
5. Add modification color-coding in annotations and Mol*.

## Progress Notes

- Add implementation notes, blockers, and verification results here as work proceeds.
- Phase 1: added peptide modification parsing and synonym normalization in `src/parsers/cdtParser.ts`; stored normalized summaries and per-site mod details on `GeneRow`; verified with `bun test` and `bun run typecheck`.
- Phase 2: updated labels, annotations, and hover details to foreground protein position plus modification state; added modification color coding in annotation rows and Mol* highlight styling; verified with `bun test`, `bun run typecheck`, and `bun run build`.
- Phase 3: added toolbar filtering for unmodified-only, modified-only, hide-unmodified, and specific modification categories; verified with `bun test`, `bun run typecheck`, and `bun run build`.
