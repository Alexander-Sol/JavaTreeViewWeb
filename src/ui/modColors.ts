import type { GeneRow } from '../model/types'

const MOD_COLOR_PALETTE = [
  '#f4c145',
  '#66c2a5',
  '#fc8d62',
  '#8da0cb',
  '#e78ac3',
  '#a6d854',
  '#ffd92f',
  '#e5c494',
]

export function getGeneModificationColor(gene: GeneRow): string {
  const key = gene.modifications.modifications[0]?.normalizedName ?? gene.modifications.category
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return MOD_COLOR_PALETTE[hash % MOD_COLOR_PALETTE.length] ?? '#f4c145'
}
