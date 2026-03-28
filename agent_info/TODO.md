# TODO

## In Progress / Recently Completed

- [x] **3-column layout** — Main heatmap left (1/3), subset heatmap middle (1/3), annotation list right (1/3).
  When a protein is loaded: protein spans top half of middle+right columns; subset heatmap and annotation
  list shrink to the bottom half of their respective columns.

## Pending

- [x] **Annotation list: show peptide position** — Each item in the annotation list should display the
  peptide's Start and End position within the protein (from the CDT metadata), if available.

- [ ] **Out-of-range peptide warning** — If a selected peptide's Start/End range falls entirely outside
  the residues present in the loaded .pdb file, show a small warning message in the lower-right corner
  of the screen when the user clicks that gene in the annotation list.

- [ ] **Reverse protein-to-heatmap selection** — Clicking a residue in the Mol* protein view should
  highlight all peptides in the heatmap that contain that residue (i.e. whose Start–End range
  covers the clicked residue position).

- [ ] **Refactor app.ts** — Split the ~1000-line `src/app.ts` into smaller, focused modules.
  Determine best TypeScript file/module structure for this kind of app.
