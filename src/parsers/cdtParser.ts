import type { CdtData, GeneRow, PeptideModification, PeptideModificationSummary, PeptideRow } from '../model/types'

const META_COLS = new Set(['GID', 'YORF', 'NAME', 'FGCOLOR', 'BGCOLOR', 'GWEIGHT'])
const SKIP_ROW_IDS = new Set(['EWEIGHT', 'BGCOLOR', 'FGCOLOR'])

const BIOLOGICAL_MODS = new Set([
  'Phosphorylation',
  'Acetylation',
  'Citrullination',
  'Hydroxyproline',
  'Methylation',
  'Diphthamide',
  'Trimethylation',
  'Succinylation',
  'Dimethylation',
  'Nitrosylation',
  'Glutarylation',
  'Palmitoylation',
  'Malonylation',
  'Crotonylation',
  'Butyrylation',
  'Hydroxybutyrylation',
  'Ubiquitination',
  'Myristoylation',
  'Lipoylation',
  'Glutamylation',
 ])

const UNINTERESTING_MODS = new Set([
  'Carbamidomethyl',
  'Carbamyl',
  'Formylation',
  'Sodium',
  'Potassium',
  'Magnesium',
  'Calcium',
  'Deamidation',
  'Deamidated',
  'Iron',
  'Ammonia',
  'Water Loss',
  'Carboxylation',
 ])

const MOD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Phospho/i, 'Phosphorylation'],
  [/Phosphothreonine/i, 'Phosphorylation'],
  [/Phosphoserine/i, 'Phosphorylation'],
  [/Phosphotyrosine/i, 'Phosphorylation'],
  [/Phosphorylation on /i, 'Phosphorylation'],
  [/Citrulli/i, 'Citrullination'],
  [/acetyl/i, 'Acetylation'],
  [/Hydroxylation on P/i, 'Hydroxyproline'],
  [/4-hydroxypro/i, 'Hydroxyproline'],
  [/xidation on P/i, 'Hydroxyproline'],
  [/Hydroxylation/i, 'Oxidation'],
  [/xidation/i, 'Oxidation'],
  [/hydroxy/i, 'Oxidation'],
  [/GG/i, 'Ubiquitination'],
  [/Omega-N/i, 'Methylation'],
  [/Tele-methly/i, 'Methylation'],
  [/-methyl/i, 'Methylation'],
  [/trimethyl/i, 'Trimethylation'],
  [/dimethyl/i, 'Dimethylation'],
  [/Symmetric/i, 'Dimethylation'],
  [/Asymmetric/i, 'Dimethylation'],
  [/Dimethylated/i, 'Dimethylation'],
  [/-nitro/i, 'Nitrosylation'],
  [/-succin/i, 'Succinylation'],
  [/-malonyl/i, 'Malonylation'],
  [/-glutamyl/i, 'Glutamylation'],
  [/butyryll/i, 'Butyrylation'],
  [/palmitoyl/i, 'Palmitoylation'],
  [/myristoyl/i, 'Myristoylation'],
  [/glutary/i, 'Glutarylation'],
  [/crotonyl/i, 'Crotonylation'],
  [/lipoyll/i, 'Lipoylation'],
  [/Pyrrolidone/i, 'Pyroglutamate'],
  [/Cysteine/i, 'Cysteine Sulfinic Acid'],
  [/N-Pyruvate/i, 'N-pyruvate 2-iminyl-valine'],
  [/Fe\[/i, 'Iron'],
  [/Cu\[/i, 'Copper'],
  [/Deamidat/i, 'Deamidation'],
  [/Water/i, 'Water Loss'],
  [/Carboxymethylation on K/i, 'Carboxymethyllysine'],
]

export function parseCdt(text: string): CdtData {
  const lines = text.split(/\r?\n/)
  const headerTokens = splitLine(lines[0] ?? '')
  const colIndex = buildColIndex(headerTokens)
  const hasGID = colIndex.has('GID')
  const hasPeptidePositions = hasStartAndEndColumns(colIndex)
  const dataStartCol = detectDataStartCol(lines, headerTokens)
  const sampleNames = headerTokens.slice(dataStartCol).map((s) => s.trim())

  let arrayIds: string[] | null = null
  const genes: GeneRow[] = []

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]
    if (line === undefined || line.trim() === '') continue

    const tokens = splitLine(line)
    const firstToken = (tokens[0] ?? '').trim().toUpperCase()

    if (firstToken === 'AID') {
      arrayIds = tokens.slice(dataStartCol).map((s) => s.trim())
      continue
    }

    if (SKIP_ROW_IDS.has(firstToken)) continue

    genes.push(parseGeneRow(headerTokens, tokens, colIndex, dataStartCol, hasGID, hasPeptidePositions))
  }

  return { sampleNames, arrayIds, genes, hasGID }
}

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
  hasPeptidePositions: boolean,
): GeneRow {
  const get = (key: string): string => {
    const idx = colIndex.get(key)
    return idx !== undefined ? (tokens[idx] ?? '') : ''
  }

  const gid = hasGID ? get('GID').trim() || null : null
  const yorf = get('YORF').trim()
  const { name, annotation, baseSequence, modifications } = parseGeneName(get('NAME'))
  const gweightStr = get('GWEIGHT').trim()
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

  const baseRow: GeneRow = { gid, yorf, name, annotation, gweight, metadata, values }
  if (!hasPeptidePositions) return baseRow

  const peptideRow: PeptideRow = {
    ...baseRow,
    baseSequence,
    modifications,
    startPosition: parseInteger(get('START')),
    endPosition: parseInteger(get('END')),
  }
  return peptideRow
}

function hasStartAndEndColumns(colIndex: Map<string, number>): boolean {
  return colIndex.has('START') && colIndex.has('END')
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseGeneName(nameString: string): {
  name: string | null
  annotation: string | null
  baseSequence: string | null
  modifications: PeptideModificationSummary
} {
  let geneName: string | null = null
  let annotation: string | null = nameString.trim() || null
  if (/^\s/.test(nameString)) {
    const parsed = parsePeptideModifications(annotation)
    return { name: null, annotation, baseSequence: parsed.baseSequence, modifications: parsed.summary }
  }

  if (/\t| {3,}/.test(nameString)) {
    const endIndex = nameString.search(/\t|\s/)
    geneName = nameString.slice(0, endIndex).trim() || null
    annotation = nameString.slice(endIndex).trim() || null
  } else {
    geneName = nameString.trim() || null
    annotation = null
  }

  const parsed = parsePeptideModifications(geneName)
  return {
    name: geneName,
    annotation,
    baseSequence: parsed.baseSequence,
    modifications: parsed.summary,
  }
}

function parsePeptideModifications(sequenceText: string | null): {
  baseSequence: string | null
  summary: PeptideModificationSummary
} {
  const text = sequenceText?.trim() ?? ''
  if (!text) return { baseSequence: null, summary: emptyModificationSummary() }

  const modifications: PeptideModification[] = []
  const residueMap = buildResidueMap(text)
  const bracketPattern = /\[([^\]]+)\]/g
  let match: RegExpExecArray | null
  while ((match = bracketPattern.exec(text)) !== null) {
    const rawText = (match[1] ?? '').trim()
    if (!rawText) continue
    modifications.push(normalizeModification(rawText, residueMap, match.index))
  }

  const baseSequence = text.replace(/\[[^\]]+\]/g, '').trim() || null
  if (modifications.length === 0) return { baseSequence, summary: emptyModificationSummary() }

  const names = Array.from(new Set(modifications.map((mod) => mod.normalizedName)))
  return {
    baseSequence,
    summary: {
      displayLabel: names.join(', '),
      category: classifyModificationCategory(modifications),
      hasModification: true,
      modifications,
    },
  }
}

function emptyModificationSummary(): PeptideModificationSummary {
  return {
    displayLabel: 'Unmodified',
    category: 'Unmodified',
    hasModification: false,
    modifications: [],
  }
}

function buildResidueMap(text: string): number[] {
  const positions: number[] = []
  let residueIndex = 0
  let inBracket = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '[') {
      inBracket = true
      continue
    }
    if (ch === ']') {
      inBracket = false
      continue
    }
    if (inBracket) continue
    if (/[A-Z]/.test(ch)) residueIndex += 1
    positions[i] = residueIndex
  }
  return positions
}

function normalizeModification(rawText: string, residueMap: number[], bracketIndex: number): PeptideModification {
  const parts = rawText.split(':')
  const namespace = parts.length > 1 ? parts[0]!.trim() || null : null
  const detail = parts.length > 1 ? parts.slice(1).join(':').trim() : rawText
  const siteMatch = detail.match(/\bon\s+([A-Z])/i)
  const site = siteMatch?.[1]?.toUpperCase() ?? null
  const normalizedName = replaceModificationName(detail)
  const residueIndex = residueMap[Math.max(0, bracketIndex - 1)] ?? null

  return {
    rawText,
    namespace,
    normalizedName,
    category: classifySingleModification(normalizedName),
    site,
    position: residueIndex,
  }
}

function replaceModificationName(value: string): string {
  for (const [pattern, replacement] of MOD_REPLACEMENTS) {
    if (pattern.test(value)) return replacement
  }
  return value.replace(/\s+on\s+.+$/i, '').trim() || value.trim()
}

function classifySingleModification(value: string): string {
  if (BIOLOGICAL_MODS.has(value)) return value
  if (UNINTERESTING_MODS.has(value)) return 'Other Mod'
  if (value === 'Carbamidomethyl') return 'Carbamidomethylation'
  if (/Carboxymethyl/i.test(value)) return 'Carboxymethylation'
  return 'Other Mod'
}

function classifyModificationCategory(modifications: PeptideModification[]): string {
  const normalizedNames = modifications.map((mod) => mod.normalizedName)
  if (normalizedNames.some((name) => /Carboxymethyl/i.test(name))) return 'Carboxymethylation'
  if (normalizedNames.some((name) => BIOLOGICAL_MODS.has(name))) return 'Biological Mod'
  if (normalizedNames.length > 0 && normalizedNames.every((name) => name === 'Carbamidomethyl')) {
    return 'Carbamidomethylation'
  }
  return 'Other Mod'
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
