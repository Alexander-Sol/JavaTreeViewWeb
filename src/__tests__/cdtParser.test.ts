import { describe, expect, test } from 'bun:test'
import { parseCdt } from '../parsers/cdtParser'

describe('cdtParser modification support', () => {
  test('parses embedded peptide modification annotations and normalizes synonyms', () => {
    const cdt = [
      'GID\tYORF\tNAME\tGWEIGHT\tSample1',
      'AID\t\t\t\tARRY1',
      'GENE1X\tP12345\tPEPT[Uniprot: Phosphothreonine]IDEK\t1\t2.0',
      'GENE2X\tP12346\tPEPT[Common Biological: Phosphorylation on Threonine]IDEK\t1\t3.0',
    ].join('\n')

    const parsed = parseCdt(cdt)
    const [first, second] = parsed.genes

    expect(first?.baseSequence).toBe('PEPTIDEK')
    expect(first?.modifications.displayLabel).toBe('Phosphorylation')
    expect(first?.modifications.category).toBe('Biological Mod')
    expect(first?.modifications.modifications[0]?.position).toBe(4)

    expect(second?.modifications.displayLabel).toBe('Phosphorylation')
    expect(second?.modifications.category).toBe('Biological Mod')
  })
})
