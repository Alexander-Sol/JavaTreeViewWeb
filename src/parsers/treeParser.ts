import type { TreeData, TreeNodeRecord } from '../model/types'

/**
 * Parse a GTR (gene tree) or ATR (array tree) file.
 *
 * Both formats are identical tab-delimited files with columns:
 *   NODEID | LEFT | RIGHT | CORRELATION
 *
 * The header row is optional — if the first token of the first row is
 * "NODEID" it is treated as a header and skipped; otherwise all rows
 * are treated as data.
 */
export function parseTree(text: string): TreeData {
  const lines = text.split(/\r?\n/)
  const nodes: TreeNodeRecord[] = []

  let startLine = 0

  // Detect optional header row
  const firstTokens = lines[0]?.split('\t') ?? []
  if ((firstTokens[0] ?? '').trim().toUpperCase() === 'NODEID') {
    startLine = 1
  }

  for (let li = startLine; li < lines.length; li++) {
    const line = lines[li]
    if (line === undefined || line.trim() === '') continue

    const tokens = line.split('\t')
    const nodeId = (tokens[0] ?? '').trim()
    const leftId = (tokens[1] ?? '').trim()
    const rightId = (tokens[2] ?? '').trim()
    const corrStr = (tokens[3] ?? '').trim()

    if (!nodeId) continue

    const correlation = corrStr !== '' ? parseFloat(corrStr) : 0
    nodes.push({ nodeId, leftId, rightId, correlation: isNaN(correlation) ? 0 : correlation })
  }

  return { nodes }
}
