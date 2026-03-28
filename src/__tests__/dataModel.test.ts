import { describe, expect, test } from 'bun:test'
import { buildSubsetModel } from '../model/dataModel'
import type { DataModel, GeneRow, TreeNode } from '../model/types'

function makeGene(id: string): GeneRow {
  return {
    gid: id,
    yorf: id,
    name: id,
    annotation: null,
    baseSequence: id,
    modifications: {
      displayLabel: 'Unmodified',
      category: 'Unmodified',
      hasModification: false,
      modifications: [],
    },
    gweight: 1,
    metadata: {},
    values: [],
  }
}

function makeLeaf(id: string, index: number): TreeNode {
  return {
    id,
    correlation: 1,
    index,
    minIndex: index,
    maxIndex: index,
    isLeaf: true,
    left: null,
    right: null,
  }
}

describe('buildSubsetModel', () => {
  test('slices matrix and remaps tree indices for a gene subset', () => {
    const g0 = makeLeaf('g0', 0)
    const g1 = makeLeaf('g1', 1)
    const g2 = makeLeaf('g2', 2)
    const g3 = makeLeaf('g3', 3)

    const left: TreeNode = {
      id: 'left',
      correlation: 0.8,
      index: 0.5,
      minIndex: 0,
      maxIndex: 1,
      isLeaf: false,
      left: g0,
      right: g1,
    }
    const right: TreeNode = {
      id: 'right',
      correlation: 0.7,
      index: 2.5,
      minIndex: 2,
      maxIndex: 3,
      isLeaf: false,
      left: g2,
      right: g3,
    }

    const model: DataModel = {
      genes: [makeGene('g0'), makeGene('g1'), makeGene('g2'), makeGene('g3')],
      allGenes: [makeGene('g0'), makeGene('g1'), makeGene('g2'), makeGene('g3')],
      sampleNames: ['s0', 's1', 's2'],
      expressionMatrix: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10, 11, 12],
      ],
      geneTree: {
        id: 'root',
        correlation: 0.2,
        index: 1.5,
        minIndex: 0,
        maxIndex: 3,
        isLeaf: false,
        left,
        right,
      },
      arrayTree: null,
      geneTreeCorrMin: 0.2,
      arrayTreeCorrMin: 0,
      valueMin: 1,
      valueMax: 12,
      valueMeanAbsolute: 6.5,
      modificationCategories: ['Unmodified'],
    }

    const subset = buildSubsetModel(model, [2, 3], null)

    expect(subset.genes.map((gene) => gene.yorf)).toEqual(['g2', 'g3'])
    expect(subset.expressionMatrix).toEqual([
      [7, 8, 9],
      [10, 11, 12],
    ])
    expect(subset.geneTree?.id).toBe('right')
    expect(subset.geneTree?.minIndex).toBe(0)
    expect(subset.geneTree?.maxIndex).toBe(1)
    expect(subset.geneTree?.left?.index).toBe(0)
    expect(subset.geneTree?.right?.index).toBe(1)
  })

  test('slices both axes when gene and sample ranges are provided', () => {
    const model: DataModel = {
      genes: [makeGene('g0'), makeGene('g1'), makeGene('g2')],
      allGenes: [makeGene('g0'), makeGene('g1'), makeGene('g2')],
      sampleNames: ['s0', 's1', 's2', 's3'],
      expressionMatrix: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
      ],
      geneTree: null,
      arrayTree: null,
      geneTreeCorrMin: 0,
      arrayTreeCorrMin: 0,
      valueMin: 1,
      valueMax: 12,
      valueMeanAbsolute: 6.5,
      modificationCategories: ['Unmodified'],
    }

    const subset = buildSubsetModel(model, [1, 2], [1, 2])

    expect(subset.genes.map((gene) => gene.yorf)).toEqual(['g1', 'g2'])
    expect(subset.sampleNames).toEqual(['s1', 's2'])
    expect(subset.expressionMatrix).toEqual([
      [6, 7],
      [10, 11],
    ])
  })
})
