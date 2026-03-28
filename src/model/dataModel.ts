import type { CdtData, DataModel, GeneRow, TreeData, TreeNode, TreeNodeRecord } from './types'

/**
 * Build the full DataModel from parsed CDT data and optional tree files.
 *
 * Steps:
 *  1. Build gene tree (if GTR data provided)
 *  2. Build array tree (if ATR data provided)
 *  3. Determine gene display order via in-order tree traversal (or CDT row order)
 *  4. Determine sample display order similarly
 *  5. Build expression matrix in display order
 *  6. Compute value statistics
 */
export function buildDataModel(
  cdtData: CdtData,
  gtrData: TreeData | null,
  atrData: TreeData | null,
): DataModel {
  // Map GID → original CDT row index (needed for tree leaf placement)
  const gidToRowIdx = new Map<string, number>()
  if (cdtData.hasGID) {
    cdtData.genes.forEach((g, i) => {
      if (g.gid) gidToRowIdx.set(g.gid, i)
    })
  }

  // Map ARRY ID → original CDT column index
  const arryToColIdx = new Map<string, number>()
  if (cdtData.arrayIds) {
    cdtData.arrayIds.forEach((id, i) => {
      if (id) arryToColIdx.set(id, i)
    })
  }

  // Build trees
  const { tree: geneTree, corrMin: geneTreeCorrMin } =
    gtrData ? buildTree(gtrData.nodes, gidToRowIdx, cdtData.genes.length) : { tree: null, corrMin: 0 }

  const { tree: arrayTree, corrMin: arrayTreeCorrMin } =
    atrData ? buildTree(atrData.nodes, arryToColIdx, cdtData.sampleNames.length) : { tree: null, corrMin: 0 }

  // Determine display orders
  const geneDisplayOrder = geneTree
    ? inOrderLeafIndices(geneTree)
    : cdtData.genes.map((_, i) => i)

  const sampleDisplayOrder = arrayTree
    ? inOrderLeafIndices(arrayTree)
    : cdtData.sampleNames.map((_, i) => i)

  // Reorder genes and sample names
  const genes: GeneRow[] = geneDisplayOrder.map((i) => cdtData.genes[i]!)
  const modificationCategories = collectModificationCategories(cdtData.genes)
  const sampleNames: string[] = sampleDisplayOrder.map((i) => cdtData.sampleNames[i]!)

  // Build expression matrix [geneDisplayIdx][sampleDisplayIdx]
  const expressionMatrix: (number | null)[][] = genes.map((gene) => {
    return sampleDisplayOrder.map((si) => gene.values[si] ?? null)
  })

  // Value statistics
  let valueMin = Infinity
  let valueMax = -Infinity
  let absSum = 0
  let absCount = 0

  for (const row of expressionMatrix) {
    for (const v of row) {
      if (v !== null) {
        if (v < valueMin) valueMin = v
        if (v > valueMax) valueMax = v
        absSum += Math.abs(v)
        absCount++
      }
    }
  }

  if (!isFinite(valueMin)) valueMin = 0
  if (!isFinite(valueMax)) valueMax = 0
  const valueMeanAbsolute = absCount > 0 ? absSum / absCount : 1

  return {
    genes,
    allGenes: cdtData.genes,
    sampleNames,
    expressionMatrix,
    geneTree,
    arrayTree,
    geneTreeCorrMin,
    arrayTreeCorrMin,
    valueMin,
    valueMax,
    valueMeanAbsolute,
    modificationCategories,
  }
}

export function buildSubsetModel(
  model: DataModel,
  geneRange: [number, number] | null,
  sampleRange: [number, number] | null,
): DataModel {
  const [geneLo, geneHi] = normalizeRange(geneRange, model.genes.length)
  const [sampleLo, sampleHi] = normalizeRange(sampleRange, model.sampleNames.length)

  const genes = model.genes.slice(geneLo, geneHi + 1)
  const sampleNames = model.sampleNames.slice(sampleLo, sampleHi + 1)
  const expressionMatrix = model.expressionMatrix
    .slice(geneLo, geneHi + 1)
    .map((row) => row.slice(sampleLo, sampleHi + 1))

  const geneTree = geneRange
    ? sliceTreeToRange(model.geneTree, geneLo, geneHi)
    : model.geneTree
  const arrayTree = sampleRange
    ? sliceTreeToRange(model.arrayTree, sampleLo, sampleHi)
    : model.arrayTree

  return {
    genes,
    allGenes: model.allGenes,
    sampleNames,
    expressionMatrix,
    geneTree,
    arrayTree,
    geneTreeCorrMin: computeCorrMin(geneTree),
    arrayTreeCorrMin: computeCorrMin(arrayTree),
    modificationCategories: model.modificationCategories,
    ...computeValueStats(expressionMatrix),
  }
}

function collectModificationCategories(genes: GeneRow[]): string[] {
  const categories = new Set<string>()
  for (const gene of genes) {
    categories.add(gene.modifications.category)
    for (const mod of gene.modifications.modifications) categories.add(mod.normalizedName)
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b))
}

// ============================================================
// Tree building
// ============================================================

interface BuildResult {
  tree: TreeNode | null
  corrMin: number
}

/**
 * Build a TreeNode hierarchy from a list of TreeNodeRecords.
 *
 * Records are topologically ordered (root last in most JTV files),
 * so we process them in order and always find children already in the map.
 *
 * @param records   Parsed node records
 * @param leafIdMap Map from leaf ID ("GENExX" / "ARRYxX") to its index position
 * @param totalLeaves Total number of leaves (genes or samples)
 */
function buildTree(
  records: TreeNodeRecord[],
  leafIdMap: Map<string, number>,
  totalLeaves: number,
): BuildResult {
  if (records.length === 0) return { tree: null, corrMin: 0 }

  const nodeMap = new Map<string, TreeNode>()

  // Pre-create leaf nodes for any IDs referenced by the records
  const ensureLeaf = (id: string): TreeNode => {
    if (nodeMap.has(id)) return nodeMap.get(id)!

    const idx = leafIdMap.get(id) ?? -1
    const leaf: TreeNode = {
      id,
      correlation: 1.0,
      index: idx >= 0 ? idx : 0,
      minIndex: idx >= 0 ? idx : 0,
      maxIndex: idx >= 0 ? idx : 0,
      isLeaf: true,
      left: null,
      right: null,
    }
    nodeMap.set(id, leaf)
    return leaf
  }

  let root: TreeNode | null = null
  let corrMin = 1.0

  for (const record of records) {
    let left = nodeMap.get(record.leftId) ?? ensureLeaf(record.leftId)
    let right = nodeMap.get(record.rightId) ?? ensureLeaf(record.rightId)

    // Ensure left subtree has the smaller index (matches Java's convention)
    if (left.index > right.index) {
      const tmp = left
      left = right
      right = tmp
    }

    const node: TreeNode = {
      id: record.nodeId,
      correlation: record.correlation,
      index: (left.index + right.index) / 2,
      minIndex: left.minIndex,
      maxIndex: right.maxIndex,
      isLeaf: false,
      left,
      right,
    }

    nodeMap.set(record.nodeId, node)
    root = node

    if (record.correlation < corrMin) corrMin = record.correlation
  }

  if (!root) return { tree: null, corrMin: 0 }

  // Validate and clamp corrMin (protect against degenerate data)
  if (!isFinite(corrMin) || corrMin >= 1.0) corrMin = -0.5

  // Fill in any missing leaf indices by re-doing an in-order traversal
  // (handles edge cases where the leaf ID map had no entry)
  repairLeafIndices(root, totalLeaves)

  return { tree: root, corrMin }
}

/**
 * Walk the tree in-order; if any leaf has index -1 (unmapped), assign a
 * sequential index so the tree is at least self-consistent.
 */
function repairLeafIndices(root: TreeNode, _totalLeaves: number): void {
  let counter = 0
  const visit = (node: TreeNode): void => {
    if (node.isLeaf) {
      if (node.index < 0) {
        node.index = counter
        node.minIndex = counter
        node.maxIndex = counter
      }
      counter++
      return
    }
    if (node.left) visit(node.left)
    if (node.right) visit(node.right)
    // Recompute internal node index from children
    const l = node.left!
    const r = node.right!
    node.index = (l.index + r.index) / 2
    node.minIndex = Math.min(l.minIndex, r.minIndex)
    node.maxIndex = Math.max(l.maxIndex, r.maxIndex)
  }
  visit(root)
}

// ============================================================
// In-order traversal
// ============================================================

/**
 * Return leaf node indices in in-order traversal order.
 * This gives the display order for genes/samples when a tree is present.
 */
function inOrderLeafIndices(root: TreeNode): number[] {
  const result: number[] = []
  const stack: TreeNode[] = []
  let current: TreeNode | null = root

  // Iterative in-order traversal
  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push(current)
      current = current.left
    }
    current = stack.pop()!
    if (current.isLeaf) {
      result.push(current.index)
    }
    current = current.right
  }

  return result
}

function normalizeRange(range: [number, number] | null, count: number): [number, number] {
  if (count <= 0) return [0, -1]
  if (!range) return [0, count - 1]

  return [
    clamp(Math.min(range[0], range[1]), 0, count - 1),
    clamp(Math.max(range[0], range[1]), 0, count - 1),
  ]
}

function sliceTreeToRange(root: TreeNode | null, lo: number, hi: number): TreeNode | null {
  if (!root) return null
  if (root.maxIndex < lo || root.minIndex > hi) return null

  if (root.isLeaf) {
    if (root.index < lo || root.index > hi) return null
    const nextIndex = root.index - lo
    return {
      ...root,
      index: nextIndex,
      minIndex: nextIndex,
      maxIndex: nextIndex,
      left: null,
      right: null,
    }
  }

  const left = sliceTreeToRange(root.left, lo, hi)
  const right = sliceTreeToRange(root.right, lo, hi)

  if (!left) return right
  if (!right) return left

  return {
    id: root.id,
    correlation: root.correlation,
    index: (left.index + right.index) / 2,
    minIndex: Math.min(left.minIndex, right.minIndex),
    maxIndex: Math.max(left.maxIndex, right.maxIndex),
    isLeaf: false,
    left,
    right,
  }
}

function computeCorrMin(root: TreeNode | null): number {
  if (!root) return 0

  let corrMin = 1.0
  const stack: TreeNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.isLeaf) continue
    if (node.correlation < corrMin) corrMin = node.correlation
    if (node.left) stack.push(node.left)
    if (node.right) stack.push(node.right)
  }

  return !isFinite(corrMin) || corrMin >= 1.0 ? -0.5 : corrMin
}

function computeValueStats(expressionMatrix: (number | null)[][]): Pick<DataModel, 'valueMin' | 'valueMax' | 'valueMeanAbsolute'> {
  let valueMin = Infinity
  let valueMax = -Infinity
  let absSum = 0
  let absCount = 0

  for (const row of expressionMatrix) {
    for (const v of row) {
      if (v !== null) {
        if (v < valueMin) valueMin = v
        if (v > valueMax) valueMax = v
        absSum += Math.abs(v)
        absCount++
      }
    }
  }

  if (!isFinite(valueMin)) valueMin = 0
  if (!isFinite(valueMax)) valueMax = 0

  return {
    valueMin,
    valueMax,
    valueMeanAbsolute: absCount > 0 ? absSum / absCount : 1,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
