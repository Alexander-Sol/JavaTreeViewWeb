import { describe, expect, test } from 'bun:test'
import {
  collectProteinSegmentsFromGenes,
  detectProteinStructureFormat,
  pdbmlToPdb,
  prepareProteinStructureText,
} from '../renderers/proteinStructure'
import type { GeneRow } from '../model/types'

const pdbPath = `${import.meta.dir}/../../public/sample-data/6A9P.pdb`
const pdbXmlPath = `${import.meta.dir}/../../public/sample-data/6A9P.xml`

function makeGeneRow(metadata: Record<string, string>): GeneRow {
  return {
    gid: null,
    yorf: 'PEPTIDE',
    name: 'Peptide',
    gweight: 1,
    metadata,
    values: [],
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
    const segments = collectProteinSegmentsFromGenes([
      makeGeneRow({ PEPTIDE_START: '218', PEPTIDE_END: '230', CHAIN: 'A' }),
      makeGeneRow({ PEPTIDE_RANGE: '231-258', CHAIN: 'A' }),
      makeGeneRow({ START: '400', END: '410', CHAIN: 'B' }),
    ])

    expect(segments).toEqual([
      { start: 218, end: 258, chainId: 'A', sequenceIdKind: 'auth' },
      { start: 400, end: 410, chainId: 'B', sequenceIdKind: 'auth' },
    ])
  })
})
