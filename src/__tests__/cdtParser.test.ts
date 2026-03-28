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

    expect('baseSequence' in (first ?? {})).toBe(false)
    expect('modifications' in (first ?? {})).toBe(false)

    expect('baseSequence' in (second ?? {})).toBe(false)
    expect('modifications' in (second ?? {})).toBe(false)
  })

  test('classifies unmodified peptides when no brackets are present', () => {
    const cdt = [
      'GID\tYORF\tNAME\tGWEIGHT\tSample1',
      'AID\t\t\t\tARRY1',
      'GENE1X\tP12345\tPEPTIDEK\t1\t2.0',
    ].join('\n')

    const parsed = parseCdt(cdt)
    expect('modifications' in (parsed.genes[0] ?? {})).toBe(false)
  })

  test('creates peptide rows when start and end columns exist', () => {
    const cdt = [
      'GID\tYORF\tNAME\tSTART\tEND\tGWEIGHT\tSample1',
      'AID\t\t\t\t\t\tARRY1',
      'GENE1X\tP12345\tPEPTIDEK\t17\t24\t1\t2.0',
    ].join('\n')

    const parsed = parseCdt(cdt)
    expect(parsed.genes[0]).toMatchObject({
      startPosition: 17,
      endPosition: 24,
      baseSequence: 'PEPTIDEK',
      modifications: {
        displayLabel: 'Unmodified',
        category: 'Unmodified',
      },
    })
  })

  test('does not create peptide rows when start and end columns are absent', () => {
    const cdt = [
      'GID\tYORF\tNAME\tGWEIGHT\tSample1',
      'AID\t\t\t\tARRY1',
      'GENE1X\tP12345\tPEPTIDEK\t1\t2.0',
    ].join('\n')

    const parsed = parseCdt(cdt)
    expect('startPosition' in (parsed.genes[0] ?? {})).toBe(false)
    expect('endPosition' in (parsed.genes[0] ?? {})).toBe(false)
  })
})
