import { describe, expect, test } from 'bun:test'
import {
  collectProteinSegmentsFromGenes,
  detectProteinStructureFormat,
  extractProteinPosition,
  pdbmlToPdb,
  prepareProteinStructureText,
} from '../renderers/proteinStructure'
import type { GeneRow, PeptideRow } from '../model/types'
import { getGeneModificationColor } from '../ui/modColors'

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
})
