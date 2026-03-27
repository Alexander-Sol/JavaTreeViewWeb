// ============================================================
// Raw parsed data from files
// ============================================================

export interface CdtData {
  /** Experiment/sample names in file column order */
  sampleNames: string[]
  /** Array IDs from the AID metadata row, if present (e.g. "ARRY16X") */
  arrayIds: string[] | null
  /** Gene rows in file row order */
  genes: GeneRow[]
  /** Whether a GID column is present (enables linking to GTR tree) */
  hasGID: boolean
}

export interface GeneRow {
  /** Tree leaf identifier, e.g. "GENE94X" — null when hasGID is false */
  gid: string | null
  /** Primary gene identifier, e.g. "YKR091W" */
  yorf: string
  /** Gene annotation / common name */
  name: string
  /** Expression weight (usually 1.0) */
  gweight: number
  /** Additional non-expression metadata columns preserved from the CDT row */
  metadata: Record<string, string>
  /** Log2 expression values, null = missing data */
  values: (number | null)[]
}

export interface TreeData {
  nodes: TreeNodeRecord[]
}

export interface TreeNodeRecord {
  /** e.g. "NODE1X" */
  nodeId: string
  /** Left child ID — either "NODExX" or a leaf ID ("GENExX" / "ARRYxX") */
  leftId: string
  /** Right child ID */
  rightId: string
  /** Pearson correlation at merge point (0 = unrelated, 1 = identical) */
  correlation: number
}

// ============================================================
// Processed tree node structure
// ============================================================

export interface TreeNode {
  id: string
  /** Branch height; leaves = 1.0, root ≈ low value */
  correlation: number
  /** Center leaf index (fractional for internal nodes) */
  index: number
  minIndex: number
  maxIndex: number
  isLeaf: boolean
  left: TreeNode | null
  right: TreeNode | null
}

// ============================================================
// Full application data model
// ============================================================

export interface DataModel {
  /** Genes in display order (tree leaf order if tree present, else CDT row order) */
  genes: GeneRow[]
  /** Sample names in display order */
  sampleNames: string[]
  /** [geneIndex][sampleIndex], null = missing */
  expressionMatrix: (number | null)[][]

  geneTree: TreeNode | null
  arrayTree: TreeNode | null

  /** Min correlation across the whole gene tree (for the correlation axis scale) */
  geneTreeCorrMin: number
  arrayTreeCorrMin: number

  valueMin: number
  valueMax: number
  /** Mean of |values|, used to auto-set contrast */
  valueMeanAbsolute: number
}

// ============================================================
// Color system
// ============================================================

export type ColorSchemeName = 'RedGreen' | 'YellowBlue'

export interface ColorScheme {
  name: ColorSchemeName
  /** RGB 0–255 for the positive (up-regulated) end */
  upColor: readonly [number, number, number]
  /** RGB for zero expression */
  zeroColor: readonly [number, number, number]
  /** RGB for the negative (down-regulated) end */
  downColor: readonly [number, number, number]
  /** RGB for missing data cells */
  missingColor: readonly [number, number, number]
}

// ============================================================
// Viewport / coordinate state
// ============================================================

export interface ViewportState {
  geneOffset: number
  geneScale: number
  sampleOffset: number
  sampleScale: number
}

// ============================================================
// Selection state
// ============================================================

export interface SelectionState {
  /** Range of gene indices currently selected (inclusive), or null */
  geneRange: [number, number] | null
  /** Range of sample indices currently selected (inclusive), or null */
  sampleRange: [number, number] | null
  /** The tree node that was clicked to create the selection */
  geneNode: TreeNode | null
  arrayNode: TreeNode | null
}
