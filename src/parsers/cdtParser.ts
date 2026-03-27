import type { CdtData, GeneRow } from '../model/types'

/**
 * Column names that are metadata (not expression data).
 * Order matters: defines which columns appear before the data columns.
 */
const META_COLS = new Set(['GID', 'YORF', 'NAME', 'FGCOLOR', 'BGCOLOR', 'GWEIGHT'])

/**
 * Row identifiers that mark special metadata rows (not gene data rows).
 */
const SKIP_ROW_IDS = new Set(['EWEIGHT', 'BGCOLOR', 'FGCOLOR'])

/**
 * Parse a CDT (Cluster Document Text) tab-delimited file.
 *
 * Handles two formats:
 *   - GID format  (spellman):   GID | YORF | NAME | GWEIGHT | [samples...]
 *   - YORF format (colorTest):  YORF | NAME | FGCOLOR | BGCOLOR | GWEIGHT | [samples...]
 *
 * Special rows (AID, EWEIGHT, BGCOLOR, FGCOLOR) are recognised and skipped
 * or recorded appropriately.
 */
export function parseCdt(text: string): CdtData {
  const lines = text.split(/\r?\n/)

  // ---- Parse header row ----
  const headerTokens = splitLine(lines[0] ?? '')
  const colIndex = buildColIndex(headerTokens)

  const hasGID = colIndex.has('GID')

  const dataStartCol = detectDataStartCol(lines, headerTokens)

  // Sample names: everything from dataStartCol onward in the header row
  const sampleNames = headerTokens.slice(dataStartCol).map((s) => s.trim())

  let arrayIds: string[] | null = null
  const genes: GeneRow[] = []

  // ---- Parse remaining rows ----
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]
    if (line === undefined || line.trim() === '') continue

    const tokens = splitLine(line)
    const firstToken = (tokens[0] ?? '').trim().toUpperCase()

    // AID row: contains array/sample tree leaf IDs
    if (firstToken === 'AID') {
      arrayIds = tokens.slice(dataStartCol).map((s) => s.trim())
      continue
    }

    // Skip other metadata rows
    if (SKIP_ROW_IDS.has(firstToken)) continue

    // Data row
    const gene = parseGeneRow(headerTokens, tokens, colIndex, dataStartCol, hasGID)
    genes.push(gene)
  }

  return { sampleNames, arrayIds, genes, hasGID }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Split a tab-delimited line, handling quoted fields (e.g. "RGR1, name").
 */
function splitLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === '\t' && !inQuote) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/**
 * Build a map from upper-cased column name → column index.
 */
function buildColIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? '').trim().toUpperCase()
    if (h && !map.has(h)) map.set(h, i)
  }
  return map
}

function parseGeneRow(
  headers: string[],
  tokens: string[],
  colIndex: Map<string, number>,
  dataStartCol: number,
  hasGID: boolean,
): GeneRow {
  const get = (key: string): string => {
    const idx = colIndex.get(key)
    return idx !== undefined ? (tokens[idx] ?? '').trim() : ''
  }

  const gid = hasGID ? get('GID') || null : null
  const yorf = get('YORF')
  const { name, annotation } = parseGeneName(get('NAME'))
  const gweightStr = get('GWEIGHT')
  const gweight = gweightStr !== '' ? parseFloat(gweightStr) : 1.0

  const metadata: Record<string, string> = {}
  for (let i = 0; i < dataStartCol; i++) {
    const rawHeader = (headers[i] ?? '').trim()
    const header = rawHeader.toUpperCase()
    if (!rawHeader || META_COLS.has(header)) continue
    metadata[rawHeader] = (tokens[i] ?? '').trim()
  }

  const rawValues = tokens.slice(dataStartCol)
  const values: (number | null)[] = rawValues.map((v) => {
    const s = v.trim()
    if (s === '') return null
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  })

  return { gid, yorf, name, annotation, gweight, metadata, values }
}

function parseGeneName(nameString:string): {name: string | null, annotation: string | null} {
  let geneName: string | null = null
  let annotation: string | null = nameString
  if (/\t| {3,}/.test(nameString)) { // If we've got a long stretch of spaces or a tab, it's probably separating name from annotation
    if (/^\s/.test(nameString)){ // If it starts with whitespace, it's probably missing the name and just has annotation
       annotation = nameString.trim()
    }
    const endIndex = nameString.search(/\t|\s/)
    geneName = nameString.slice(0, endIndex).trim() || null
    annotation = nameString.slice(endIndex).trim() || null
  } else {
    geneName = nameString.trim() || null // TODO: Will need to handle peptide mod parsing here later
  }
  return { name: geneName, annotation: annotation }
}

function detectDataStartCol(lines: string[], headerTokens: string[]): number {
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]
    if (line === undefined || line.trim() === '') continue

    const tokens = splitLine(line)
    const rowId = (tokens[0] ?? '').trim().toUpperCase()
    if (rowId !== 'AID' && rowId !== 'EWEIGHT') continue

    for (let i = 1; i < tokens.length; i++) {
      if ((tokens[i] ?? '').trim() !== '') return i
    }
  }

  for (let i = 0; i < headerTokens.length; i++) {
    const h = (headerTokens[i] ?? '').toUpperCase()
    if (!META_COLS.has(h)) return i
  }

  return headerTokens.length
}
