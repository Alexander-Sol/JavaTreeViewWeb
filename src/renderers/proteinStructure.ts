import type { GeneRow } from '../model/types'
import { getGeneModificationColor } from '../ui/modColors'

export type ProteinStructureFormat = 'pdb' | 'pdbxml'
export type ProteinSequenceIdKind = 'auth' | 'label'

export interface ProteinSegment {
  start: number
  end: number
  chainId?: string
  sequenceIdKind?: ProteinSequenceIdKind
  color?: string
  label?: string
}

const START_KEYS = [
  'PEPTIDE_START',
  'START',
  'START_POS',
  'START_POSITION',
  'RESIDUE_START',
  'PROTEIN_START',
]

const END_KEYS = [
  'PEPTIDE_END',
  'END',
  'END_POS',
  'END_POSITION',
  'RESIDUE_END',
  'PROTEIN_END',
]

const RANGE_KEYS = ['PEPTIDE', 'PEPTIDE_RANGE', 'RESIDUE_RANGE', 'SEGMENT', 'SEGMENT_RANGE']
const CHAIN_KEYS = ['CHAIN', 'CHAIN_ID', 'AUTH_ASYM_ID', 'LABEL_ASYM_ID', 'PDB_CHAIN']
const LABEL_SEQ_HINT_KEYS = ['LABEL_SEQ_RANGE', 'LABEL_RESIDUE_RANGE']

export function detectProteinStructureFormat(filename: string): ProteinStructureFormat | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdb')) return 'pdb'
  if (lower.endsWith('.xml') || lower.endsWith('.pdbxml')) return 'pdbxml'
  return null
}

export function prepareProteinStructureText(
  text: string,
  format: ProteinStructureFormat,
): string {
  return format === 'pdbxml' ? pdbmlToPdb(text) : text
}

export function normalizeProteinSegments(segments: ProteinSegment[]): ProteinSegment[] {
  const cleaned: ProteinSegment[] = []
  for (const segment of segments) {
      const start = Math.trunc(segment.start)
      const end = Math.trunc(segment.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue

      cleaned.push({
        start: Math.min(start, end),
        end: Math.max(start, end),
        chainId: segment.chainId?.trim() || undefined,
        sequenceIdKind: segment.sequenceIdKind ?? 'auth',
      })
  }

  cleaned.sort(compareSegments)

  const merged: ProteinSegment[] = []
  for (const segment of cleaned) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.chainId === segment.chainId &&
      previous.sequenceIdKind === segment.sequenceIdKind &&
      segment.start <= previous.end + 1
    ) {
      previous.end = Math.max(previous.end, segment.end)
      continue
    }
    merged.push({ ...segment })
  }

  return merged
}

export function collectProteinSegmentsFromGenes(genes: GeneRow[]): ProteinSegment[] {
  const segments: ProteinSegment[] = []

  for (const gene of genes) {
    const metadata = normalizeMetadata(gene.metadata)
    const chainId = getMetadataValue(metadata, CHAIN_KEYS) || undefined
    const sequenceIdKind: ProteinSequenceIdKind =
      getMetadataValue(metadata, LABEL_SEQ_HINT_KEYS) ? 'label' : 'auth'

      const directStart = parseInteger(getMetadataValue(metadata, START_KEYS))
      const directEnd = parseInteger(getMetadataValue(metadata, END_KEYS))
      if (directStart !== null && directEnd !== null) {
      segments.push({
        start: directStart,
        end: directEnd,
        chainId,
        sequenceIdKind,
        color: getGeneModificationColor(gene),
        label: gene.modifications.displayLabel,
      })
      continue
    }

    const rangeValue = getMetadataValue(metadata, RANGE_KEYS)
    if (!rangeValue) continue

    const parsedRange = parseRange(rangeValue)
    if (!parsedRange) continue

    segments.push({
      start: parsedRange.start,
      end: parsedRange.end,
      chainId,
      sequenceIdKind,
      color: getGeneModificationColor(gene),
      label: gene.modifications.displayLabel,
    })
  }

  return normalizeProteinSegments(segments)
}

export function pdbmlToPdb(xmlText: string): string {
  const atomSites = parsePdbmlAtomSites(xmlText)
  if (atomSites.length === 0) throw new Error('PDBXML document contains no atom_site entries')

  const lines: string[] = []
  let currentModel: string | null = null

  for (const fields of atomSites) {
    const recordName = fields['group_PDB'] || 'ATOM'
    if (recordName !== 'ATOM' && recordName !== 'HETATM') continue

    const modelNum = fields['pdbx_PDB_model_num'] || '1'
    if (currentModel === null) {
      currentModel = modelNum
      lines.push(formatModelLine(modelNum))
    } else if (modelNum !== currentModel) {
      lines.push('ENDMDL')
      currentModel = modelNum
      lines.push(formatModelLine(modelNum))
    }

    lines.push(
      formatAtomLine({
        recordName,
        serial: parseInteger(fields['id']) ?? lines.length,
        atomName: fields['auth_atom_id'] || fields['label_atom_id'] || 'X',
        altLoc: normalizePdbCharacter(fields['label_alt_id']),
        residueName: fields['auth_comp_id'] || fields['label_comp_id'] || 'UNK',
        chainId:
          normalizePdbCharacter(fields['auth_asym_id']) ||
          normalizePdbCharacter(fields['label_asym_id']) ||
          'A',
        residueId: parseInteger(fields['auth_seq_id']) ?? parseInteger(fields['label_seq_id']) ?? 1,
        insertionCode: normalizePdbCharacter(fields['pdbx_PDB_ins_code']),
        x: parseFloat(fields['Cartn_x'] || '0'),
        y: parseFloat(fields['Cartn_y'] || '0'),
        z: parseFloat(fields['Cartn_z'] || '0'),
        occupancy: parseFloat(fields['occupancy'] || '1'),
        bFactor: parseFloat(fields['B_iso_or_equiv'] || '0'),
        element: (fields['type_symbol'] || '').trim().slice(0, 2),
        charge: formatCharge(fields['pdbx_formal_charge']),
      }),
    )
  }

  if (currentModel !== null) lines.push('ENDMDL')
  lines.push('END')

  return lines.join('\n')
}

function normalizeMetadata(metadata: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    normalized[key.trim().toUpperCase()] = value.trim()
  }
  return normalized
}

function getMetadataValue(
  metadata: Record<string, string>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = metadata[key]
    if (value) return value
  }
  return null
}

function parseInteger(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseRange(value: string): { start: number; end: number } | null {
  const match = value.match(/(-?\d+)\s*(?:-|\.\.|:)\s*(-?\d+)/)
  if (!match) return null

  const start = Number.parseInt(match[1] ?? '', 10)
  const end = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null

  return { start, end }
}

function compareSegments(a: ProteinSegment, b: ProteinSegment): number {
  return (
    compareText(a.chainId, b.chainId) ||
    compareText(a.sequenceIdKind, b.sequenceIdKind) ||
    a.start - b.start ||
    a.end - b.end
  )
}

function compareText(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '')
}

function parsePdbmlAtomSites(xmlText: string): Array<Record<string, string>> {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const xml = parser.parseFromString(xmlText, 'application/xml')
    const parserError = xml.getElementsByTagName('parsererror')[0]
    if (parserError) throw new Error('Invalid PDBXML document')

    return Array.from(xml.getElementsByTagNameNS('*', 'atom_site')).map(readFields)
  }

  const atomSites: Array<Record<string, string>> = []
  const atomSitePattern = /<PDBx:atom_site\b([^>]*)>([\s\S]*?)<\/PDBx:atom_site>/g
  for (const match of xmlText.matchAll(atomSitePattern)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const fields: Record<string, string> = {}

    const idMatch = attrs.match(/\bid="([^"]+)"/)
    if (idMatch?.[1]) fields['id'] = idMatch[1]

    const nilPattern = /<PDBx:([\w_]+)\b[^>]*xsi:nil="true"\s*\/>/g
    for (const nilMatch of body.matchAll(nilPattern)) {
      const name = nilMatch[1]
      if (name) fields[name] = ''
    }

    const fieldPattern = /<PDBx:([\w_]+)\b[^>]*>([\s\S]*?)<\/PDBx:[\w_]+>/g
    for (const fieldMatch of body.matchAll(fieldPattern)) {
      const name = fieldMatch[1]
      if (!name) continue
      fields[name] = decodeXmlText(fieldMatch[2] ?? '')
    }

    atomSites.push(fields)
  }

  return atomSites
}

function readFields(atomSite: Element): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const child of Array.from(atomSite.children)) {
    const name = child.localName
    if (!name) continue
    if (
      child.getAttribute('xsi:nil') === 'true' ||
      child.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'nil') === 'true'
    ) {
      fields[name] = ''
      continue
    }
    fields[name] = child.textContent?.trim() ?? ''
  }
  const id = atomSite.getAttribute('id')
  if (id && !fields['id']) fields['id'] = id
  return fields
}

function formatModelLine(modelNum: string): string {
  return `MODEL ${modelNum.padStart(4, ' ')}`
}

function normalizePdbCharacter(value: string | undefined): string {
  return (value || '').trim().slice(0, 1) || ' '
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function formatCharge(value: string | undefined): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return '  '

  const match = trimmed.match(/^([+-]?)(\d+)$/)
  if (!match) return trimmed.padStart(2, ' ').slice(-2)

  const sign = match[1] === '-' ? '-' : '+'
  return `${match[2]}${sign}`.slice(-2)
}

function formatAtomLine(atom: {
  recordName: string
  serial: number
  atomName: string
  altLoc: string
  residueName: string
  chainId: string
  residueId: number
  insertionCode: string
  x: number
  y: number
  z: number
  occupancy: number
  bFactor: number
  element: string
  charge: string
}): string {
  const atomName = atom.atomName.trim()
  const paddedAtomName = atomName.length >= 4 ? atomName.slice(0, 4) : atomName.padStart(4, ' ')

  return [
    atom.recordName.padEnd(6, ' '),
    clampPdbInteger(atom.serial, 99999).toString().padStart(5, ' '),
    ' ',
    paddedAtomName,
    atom.altLoc,
    atom.residueName.padStart(3, ' ').slice(-3),
    ' ',
    atom.chainId,
    clampPdbInteger(atom.residueId, 9999).toString().padStart(4, ' '),
    atom.insertionCode,
    '   ',
    formatPdbFloat(atom.x, 8, 3),
    formatPdbFloat(atom.y, 8, 3),
    formatPdbFloat(atom.z, 8, 3),
    formatPdbFloat(atom.occupancy, 6, 2),
    formatPdbFloat(atom.bFactor, 6, 2),
    '          ',
    atom.element.padStart(2, ' ').slice(-2),
    atom.charge.padStart(2, ' ').slice(-2),
  ].join('')
}

function clampPdbInteger(value: number, max: number): number {
  return Math.max(-max, Math.min(max, Math.trunc(value)))
}

function formatPdbFloat(value: number, width: number, decimals: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(decimals).padStart(width, ' ').slice(-width)
}
