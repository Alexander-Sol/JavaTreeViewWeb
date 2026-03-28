import type { TreeNode } from '../model/types'
import type { AxisViewport } from './viewport'
import type { Viewport } from './viewport'

export type DendrogramOrientation = 'left' | 'top'

const HIT_TEST_RADIUS_PX = 12

/**
 * DendrogramRenderer draws a hierarchical clustering dendrogram onto a canvas.
 *
 * Orientation 'left': gene tree drawn to the left of the heatmap.
 *   - Index axis = Y (shared with viewport.genes)
 *   - Correlation axis = X (root at left, leaves at right)
 *
 * Orientation 'top': array tree drawn above the heatmap.
 *   - Index axis = X (shared with viewport.samples)
 *   - Correlation axis = Y (root at top, leaves at bottom)
 */
export class DendrogramRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private orientation: DendrogramOrientation
  private viewport: Viewport
  private tree: TreeNode | null = null
  private corrMin = -0.5
  private unsubscribe: (() => void) | null = null

  // Colors
  private lineColor = '#cccccc'
  private selectedColor = '#ffcc00'
  private selectedNodeId: string | null = null

  constructor(canvas: HTMLCanvasElement, orientation: DendrogramOrientation, viewport: Viewport) {
    this.canvas = canvas
    this.orientation = orientation
    this.viewport = viewport

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context from dendrogram canvas')
    this.ctx = ctx

    this.unsubscribe = viewport.onChange(() => this.render())
  }

  setTree(tree: TreeNode | null, corrMin: number): void {
    this.tree = tree
    this.corrMin = corrMin
    this.render()
  }

  setSelectedNodeId(id: string | null): void {
    this.selectedNodeId = id
    this.render()
  }

  resize(): void {
    const { offsetWidth: w, offsetHeight: h } = this.canvas
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.render()
  }

  render(): void {
    const { width, height } = this.canvas
    if (width === 0 || height === 0) return

    this.ctx.clearRect(0, 0, width, height)

    if (!this.tree) return

    const indexAxis: AxisViewport =
      this.orientation === 'left' ? this.viewport.genes : this.viewport.samples

    // Determine visible leaf index range for culling
    const dimSize = this.orientation === 'left' ? height : width
    const tightVisFirst = Math.max(0, Math.floor(indexAxis.pixelToIndex(0)))
    const tightVisLast = Math.min(indexAxis.count - 1, Math.ceil(indexAxis.pixelToIndex(dimSize)) - 1)
    const visFirst = Math.max(0, indexAxis.pixelToIndex(0) - 1)
    const visLast = indexAxis.pixelToIndex(dimSize) + 1
    const visibleRoot = findTightVisibleRoot(this.tree, tightVisFirst, tightVisLast)
    const drawableNodes = collectDrawableNodes(visibleRoot, visFirst, visLast, tightVisFirst, tightVisLast)

    // Correlation → pixel on the depth axis
    const corrToPixel = this.makeVisibleCorrToPixel(width, height, visibleRoot, drawableNodes)
    const selectedSubtree = this.selectedNodeId
      ? findNodeById(this.tree, this.selectedNodeId)
      : null

    // Traverse tree iteratively, drawing each internal node
    this.ctx.lineWidth = 1

    for (const node of drawableNodes) {
      const left = node.left!
      const right = node.right!
      this.drawNode(node, left, right, indexAxis, corrToPixel, selectedSubtree)
    }
  }

  /**
   * Draw the L-shaped connector for one internal node.
   *
   * For 'left' orientation (gene tree):
   *   - Horizontal lines from each child's correlation position to node's correlation
   *   - Vertical line connecting the two horizontal lines at node's correlation
   *
   * For 'top' orientation (array tree):
   *   - Vertical lines from each child's correlation position to node's correlation
   *   - Horizontal line connecting them at node's correlation
   */
  private drawNode(
    node: TreeNode,
    left: TreeNode,
    right: TreeNode,
    indexAxis: AxisViewport,
    corrToPixel: (corr: number) => number,
    selectedSubtree: TreeNode | null,
  ): void {
    // Pixel positions for child centers (index axis)
    const leftCenter = indexAxis.indexToPixel(left.index + 0.5)
    const rightCenter = indexAxis.indexToPixel(right.index + 0.5)

    // Pixel positions on the correlation (depth) axis
    const nodeDepth = corrToPixel(node.correlation)
    const leftDepth = corrToPixel(left.correlation)
    const rightDepth = corrToPixel(right.correlation)

    // Determine if this node or any ancestor is selected (for color)
    const isSelected = selectedSubtree !== null && containsNode(selectedSubtree, node.id)
    this.ctx.strokeStyle = isSelected ? this.selectedColor : this.lineColor

    this.ctx.beginPath()

    if (this.orientation === 'left') {
      // Gene tree: depth axis = X, index axis = Y
      // Left child horizontal line
      this.ctx.moveTo(leftDepth, leftCenter)
      this.ctx.lineTo(nodeDepth, leftCenter)
      // Vertical bar
      this.ctx.moveTo(nodeDepth, leftCenter)
      this.ctx.lineTo(nodeDepth, rightCenter)
      // Right child horizontal line
      this.ctx.moveTo(nodeDepth, rightCenter)
      this.ctx.lineTo(rightDepth, rightCenter)
    } else {
      // Array tree: depth axis = Y, index axis = X
      // Left child vertical line
      this.ctx.moveTo(leftCenter, leftDepth)
      this.ctx.lineTo(leftCenter, nodeDepth)
      // Horizontal bar
      this.ctx.moveTo(leftCenter, nodeDepth)
      this.ctx.lineTo(rightCenter, nodeDepth)
      // Right child vertical line
      this.ctx.moveTo(rightCenter, nodeDepth)
      this.ctx.lineTo(rightCenter, rightDepth)
    }

    this.ctx.stroke()
  }

  /**
   * Build a function that maps correlation value [corrMin..1.0] to a pixel.
   *
   * For 'left': root (low corr) → left edge (px 0), leaves (corr 1.0) → right edge (px width)
   * For 'top':  root (low corr) → top edge (px 0), leaves (corr 1.0) → bottom edge (px height)
   */
  private makeVisibleCorrToPixel(
    width: number,
    height: number,
    visibleRoot: TreeNode,
    drawableNodes: TreeNode[],
  ): (corr: number) => number {
    const size = this.orientation === 'left' ? width : height
    const corrValues = new Set<number>([visibleRoot.correlation, 1.0])
    for (const node of drawableNodes) corrValues.add(node.correlation)
    const sorted = Array.from(corrValues).sort((a, b) => a - b)
    const maxIndex = Math.max(sorted.length - 1, 1)
    const positions = new Map<number, number>()

    sorted.forEach((corr, index) => {
      positions.set(corr, (index / maxIndex) * size)
    })

    return (corr) => positions.get(corr) ?? size
  }

  /**
   * Hit-test: find the tree node nearest to a click at the given canvas coordinates.
   * Returns the nearest internal node or null.
   */
  findNearestNode(canvasX: number, canvasY: number): TreeNode | null {
    if (!this.tree) return null

    const { width, height } = this.canvas
    const indexAxis = this.orientation === 'left' ? this.viewport.genes : this.viewport.samples
    const dimSize = this.orientation === 'left' ? height : width
    const tightVisFirst = Math.max(0, Math.floor(indexAxis.pixelToIndex(0)))
    const tightVisLast = Math.min(indexAxis.count - 1, Math.ceil(indexAxis.pixelToIndex(dimSize)) - 1)
    const visFirst = Math.max(0, indexAxis.pixelToIndex(0) - 1)
    const visLast = indexAxis.pixelToIndex(dimSize) + 1
    const visibleRoot = findTightVisibleRoot(this.tree, tightVisFirst, tightVisLast)
    const drawableNodes = collectDrawableNodes(visibleRoot, visFirst, visLast, tightVisFirst, tightVisLast)
    const corrToPixel = this.makeVisibleCorrToPixel(width, height, visibleRoot, drawableNodes)

    let best: TreeNode | null = null
    let bestDist = Infinity

    for (const node of drawableNodes) {
      const dist = computeNodeHitDistance(
        node,
        this.orientation,
        indexAxis,
        corrToPixel,
        canvasX,
        canvasY,
      )

      if (dist < bestDist) {
        bestDist = dist
        best = node
      }
    }

    return bestDist <= HIT_TEST_RADIUS_PX ? best : null
  }

  destroy(): void {
    this.unsubscribe?.()
  }
}

// ============================================================
// Helpers
// ============================================================

function containsNode(root: TreeNode, targetId: string): boolean {
  if (root.id === targetId) return true
  if (root.isLeaf) return false
  return (
    (root.left ? containsNode(root.left, targetId) : false) ||
    (root.right ? containsNode(root.right, targetId) : false)
  )
}

function findNodeById(root: TreeNode, targetId: string): TreeNode | null {
  if (root.id === targetId) return root
  if (root.isLeaf) return null
  return (
    (root.left ? findNodeById(root.left, targetId) : null) ||
    (root.right ? findNodeById(root.right, targetId) : null)
  )
}

export function findTightVisibleRoot(root: TreeNode, visFirst: number, visLast: number): TreeNode {
  let current = root

  while (!current.isLeaf && current.left && current.right) {
    if (visLast < current.right.minIndex) {
      current = current.left
      continue
    }
    if (visFirst > current.left.maxIndex) {
      current = current.right
      continue
    }
    break
  }

  return current
}

export function isNodeFullyVisible(node: TreeNode, visFirst: number, visLast: number): boolean {
  return node.minIndex >= visFirst && node.maxIndex <= visLast
}

function collectDrawableNodes(
  root: TreeNode,
  visFirst: number,
  visLast: number,
  tightVisFirst: number,
  tightVisLast: number,
): TreeNode[] {
  const nodes: TreeNode[] = []
  const stack: TreeNode[] = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.isLeaf) continue
    if (node.maxIndex < visFirst || node.minIndex > visLast) continue

    const left = node.left
    const right = node.right
    if (left && !left.isLeaf) stack.push(left)
    if (right && !right.isLeaf) stack.push(right)

    if (isNodeFullyVisible(node, tightVisFirst, tightVisLast)) {
      nodes.push(node)
    }
  }

  return nodes
}

export function isNodeInSelectedSubtree(root: TreeNode, selectedNodeId: string, nodeId: string): boolean {
  const selectedSubtree = findNodeById(root, selectedNodeId)
  return selectedSubtree !== null && containsNode(selectedSubtree, nodeId)
}

export function computeNodeHitDistance(
  node: TreeNode,
  orientation: DendrogramOrientation,
  indexAxis: AxisViewport,
  corrToPixel: (corr: number) => number,
  canvasX: number,
  canvasY: number,
): number {
  if (node.isLeaf || !node.left || !node.right) return Infinity

  const leftCenter = indexAxis.indexToPixel(node.left.index + 0.5)
  const rightCenter = indexAxis.indexToPixel(node.right.index + 0.5)
  const nodeDepth = corrToPixel(node.correlation)
  const leftDepth = corrToPixel(node.left.correlation)
  const rightDepth = corrToPixel(node.right.correlation)

  if (orientation === 'left') {
    return Math.min(
      pointToSegmentDistance(canvasX, canvasY, leftDepth, leftCenter, nodeDepth, leftCenter),
      pointToSegmentDistance(canvasX, canvasY, nodeDepth, leftCenter, nodeDepth, rightCenter),
      pointToSegmentDistance(canvasX, canvasY, nodeDepth, rightCenter, rightDepth, rightCenter),
    )
  }

  return Math.min(
    pointToSegmentDistance(canvasX, canvasY, leftCenter, leftDepth, leftCenter, nodeDepth),
    pointToSegmentDistance(canvasX, canvasY, leftCenter, nodeDepth, rightCenter, nodeDepth),
    pointToSegmentDistance(canvasX, canvasY, rightCenter, nodeDepth, rightCenter, rightDepth),
  )
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1

  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  const projX = x1 + t * dx
  const projY = y1 + t * dy
  return Math.hypot(px - projX, py - projY)
}
