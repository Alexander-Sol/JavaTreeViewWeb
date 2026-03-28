import { describe, expect, test } from 'bun:test'
import {
  collectProteinModificationMarkersFromGenes,
  collectProteinSegmentsFromGenes,
  detectProteinStructureFormat,
  extractProteinPosition,
  mapModificationToProteinPosition,
  normalizeProteinSegments,
  pdbmlToPdb,
  prepareProteinStructureText,
} from '../renderers/proteinStructure'
import type { GeneRow, PeptideRow } from '../model/types'
import { getGeneModificationColor, getPeptideModificationColor } from '../ui/modColors'

const pdbPath = `${import.meta.dir}/../../public/sample-data/6A9P.pdb`
const pdbXmlPath = `${import.meta.dir}/../../public/sample-data/6A9P.xml`

function makeGeneRow(metadata: Record<string, string>): GeneRow {
  return {
    gid: null,
    yorf: 'PEPTIDE',
    name: 'Peptide',
    annotation: null,
    gweight: 1,
    metadata,
    values: [],
  }
}

function makePeptideRow(metadata: Record<string, string>, startPosition = 1, endPosition = 1): PeptideRow {
  return {
    ...makeGeneRow(metadata),
    baseSequence: 'PEPTIDE',
    modifications: {
      displayLabel: 'Unmodified',
      category: 'Unmodified',
      hasModification: false,
      modifications: [],
    },
    startPosition,
    endPosition,
  }
}

describe('protein structure helpers', () => {
  test('detects bundled sample formats from filenames', () => {
    expect(detectProteinStructureFormat('6A9P.pdb')).toBe('pdb')
    expect(detectProteinStructureFormat('6A9P.xml')).toBe('pdbxml')
  })

  test('passes legacy pdb text through unchanged', async () => {
    const pdbText = await Bun.file(pdbPath).text()
    expect(prepareProteinStructureText(pdbText, 'pdb')).toBe(pdbText)
    expect(pdbText.includes('ATOM')).toBe(true)
  })

  test('converts PDBXML sample into pdb text Mol* can parse as pdb', async () => {
    const xmlText = await Bun.file(pdbXmlPath).text()
    const converted = pdbmlToPdb(xmlText)

    const xmlAtomCount = (xmlText.match(/<PDBx:atom_site\b/g) ?? []).length
    const pdbAtomCount = (converted.match(/^(ATOM  |HETATM)/gm) ?? []).length

    expect(converted.startsWith('MODEL')).toBe(true)
    expect(converted.trimEnd().endsWith('END')).toBe(true)
    expect(pdbAtomCount).toBe(xmlAtomCount)
    expect(/THR\s+A\s*110/.test(converted)).toBe(true)
  })

  test('collects and merges peptide residue segments from gene metadata', () => {
    const first = makePeptideRow({ CHAIN: 'A' }, 218, 230)
    const second = makePeptideRow({ CHAIN: 'A' }, 231, 258)
    const third = makePeptideRow({ CHAIN: 'B' }, 400, 410)
    const segments = collectProteinSegmentsFromGenes([
      first,
      second,
      third,
    ])

    expect(segments).toEqual([
      {
        start: 218,
        end: 258,
        chainId: 'A',
        sequenceIdKind: 'auth',
        color: getGeneModificationColor(makePeptideRow({})),
        label: 'Unmodified',
      },
      {
        start: 400,
        end: 410,
        chainId: 'B',
        sequenceIdKind: 'auth',
        color: getGeneModificationColor(makePeptideRow({})),
        label: 'Unmodified',
      },
    ])
  })

  test('does not treat peptide sequence text as a protein residue range', () => {
    const position = extractProteinPosition(makeGeneRow({ PEPTIDE: 'PEPTIDEK' }))
    expect(position).toBeNull()
  })

  test('extracts explicit numeric protein range from metadata', () => {
    const peptideRow = makePeptideRow({}, 231, 258)
    const position = extractProteinPosition(peptideRow)
    expect(position).toEqual({ start: 231, end: 258, sequenceIdKind: 'auth' })
  })

  test('falls back to modification site positions when metadata lacks residue bounds', () => {
    const peptideRow: PeptideRow = {
      ...makePeptideRow({}, 0, 0),
      startPosition: null,
      endPosition: null,
      modifications: {
        displayLabel: 'Phosphorylation',
        category: 'Biological Mod',
        hasModification: true,
        modifications: [
          { rawText: 'a', namespace: null, normalizedName: 'Phosphorylation', category: 'Phosphorylation', site: 'T', position: 9 },
          { rawText: 'b', namespace: null, normalizedName: 'Phosphorylation', category: 'Phosphorylation', site: 'S', position: 12 },
        ],
      },
    }
    const position = extractProteinPosition(peptideRow)

    expect(position).toEqual({ start: 9, end: 12, sequenceIdKind: 'auth' })
  })

  test('does not merge adjacent segments when colors differ', () => {
    expect(
      normalizeProteinSegments([
        { start: 10, end: 12, chainId: 'A', sequenceIdKind: 'auth', color: '#ff0000', label: 'A' },
        { start: 13, end: 15, chainId: 'A', sequenceIdKind: 'auth', color: '#00ff00', label: 'B' },
      ]),
    ).toEqual([
      { start: 10, end: 12, chainId: 'A', sequenceIdKind: 'auth', color: '#ff0000', label: 'A' },
      { start: 13, end: 15, chainId: 'A', sequenceIdKind: 'auth', color: '#00ff00', label: 'B' },
    ])
  })

  test('maps modification positions from peptide-relative to protein-relative residues', () => {
    expect(mapModificationToProteinPosition({ startPosition: 231 }, { position: 3 })).toBe(233)
    expect(mapModificationToProteinPosition({ startPosition: null }, { position: 3 })).toBe(3)
    expect(mapModificationToProteinPosition({ startPosition: 231 }, { position: null })).toBeNull()
  })

  test('collects site markers at mapped protein residues', () => {
    const peptideRow: PeptideRow = {
      ...makePeptideRow({ CHAIN: 'A' }, 231, 258),
      modifications: {
        displayLabel: 'Phosphorylation',
        category: 'Biological Mod',
        hasModification: true,
        modifications: [
          { rawText: 'a', namespace: null, normalizedName: 'Phosphorylation', category: 'Phosphorylation', site: 'T', position: 3 },
          { rawText: 'b', namespace: null, normalizedName: 'Oxidation', category: 'Oxidation', site: 'M', position: 5 },
        ],
      },
    }

    expect(collectProteinModificationMarkersFromGenes([peptideRow])).toEqual([
      {
        position: 233,
        chainId: 'A',
        sequenceIdKind: 'auth',
        color: getPeptideModificationColor(peptideRow.modifications.modifications[0]!),
        label: 'Phosphorylation at T233 (Phosphorylation)',
      },
      {
        position: 235,
        chainId: 'A',
        sequenceIdKind: 'auth',
        color: getPeptideModificationColor(peptideRow.modifications.modifications[1]!),
        label: 'Oxidation at M235 (Phosphorylation)',
      },
    ])
  })
})
