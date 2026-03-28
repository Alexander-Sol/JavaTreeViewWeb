import { describe, expect, test } from 'bun:test'
import type { DataModel, GeneRow, PeptideRow } from '../model/types'

const MOD_FILTER_ALL = '__ALL__'
const MOD_FILTER_MODIFIED = '__MODIFIED__'

function makeGene(id: string): GeneRow {
  return {
    gid: id,
    yorf: id,
    name: id,
    annotation: null,
    gweight: 1,
    metadata: {},
    values: [1],
  }
}

function makePeptide(id: string, category: string, hasModification: boolean): PeptideRow {
  return {
    ...makeGene(id),
    baseSequence: id,
    startPosition: 1,
    endPosition: 8,
    modifications: {
      displayLabel: category,
      category,
      hasModification,
      modifications: hasModification
        ? [{ rawText: category, namespace: null, normalizedName: category, category, site: null, position: null }]
        : [],
    },
  }
}

function isPeptideRow(gene: GeneRow): gene is PeptideRow {
  return 'baseSequence' in gene && 'modifications' in gene && 'startPosition' in gene && 'endPosition' in gene
}

function matchesModificationFilter(gene: GeneRow, modFilter: string): boolean {
  if (modFilter === MOD_FILTER_ALL) return true
  if (!isPeptideRow(gene)) return modFilter === 'Unmodified'
  if (modFilter === 'Unmodified') return !gene.modifications.hasModification
  if (modFilter === MOD_FILTER_MODIFIED) return gene.modifications.hasModification
  if (modFilter === '__HIDE_UNMODIFIED__') return gene.modifications.hasModification
  return gene.modifications.category === modFilter || gene.modifications.modifications.some((mod) => mod.normalizedName === modFilter)
}

function applyFilter(baseModel: DataModel, modFilter: string): DataModel {
  const filteredGenes = baseModel.genes.filter((gene) => matchesModificationFilter(gene, modFilter))
  return {
    ...baseModel,
    genes: filteredGenes,
    expressionMatrix: filteredGenes.map((gene) => [...gene.values]),
  }
}

describe('modification filtering', () => {
  test('sequential filtering always uses the original base model', () => {
    const genes: GeneRow[] = [
      makePeptide('pep-unmod', 'Unmodified', false),
      makePeptide('pep-phospho', 'Biological Mod', true),
      makePeptide('pep-acetyl', 'Acetylation', true),
    ]

    const baseModel: DataModel = {
      genes,
      allGenes: genes,
      sampleNames: ['s1'],
      expressionMatrix: genes.map((gene) => [...gene.values]),
      geneTree: null,
      arrayTree: null,
      geneTreeCorrMin: 0,
      arrayTreeCorrMin: 0,
      valueMin: 1,
      valueMax: 1,
      valueMeanAbsolute: 1,
      modificationCategories: ['Unmodified', 'Biological Mod', 'Acetylation'],
    }

    const modifiedOnly = applyFilter(baseModel, MOD_FILTER_MODIFIED)
    expect(modifiedOnly.genes.map((gene) => gene.yorf)).toEqual(['pep-phospho', 'pep-acetyl'])

    const unmodifiedOnly = applyFilter(baseModel, 'Unmodified')
    expect(unmodifiedOnly.genes.map((gene) => gene.yorf)).toEqual(['pep-unmod'])

    const acetylOnly = applyFilter(baseModel, 'Acetylation')
    expect(acetylOnly.genes.map((gene) => gene.yorf)).toEqual(['pep-acetyl'])
  })
})
