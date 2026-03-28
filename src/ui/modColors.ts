import type { PeptideModification, PeptideRow } from '../model/types'

const MOD_COLOR_PALETTE = [
  '#ffd166',
  '#4fd1b5',
  '#ff8a5b',
  '#7aa2ff',
  '#ff7bc2',
  '#9be564',
  '#ffe45e',
  '#f6bd60',
]

export function getGeneModificationColor(gene: PeptideRow): string {
  const key = gene.modifications.modifications[0]?.normalizedName ?? gene.modifications.category
  return getModificationColor(key)
}

export function getPeptideModificationColor(modification: Pick<PeptideModification, 'normalizedName' | 'category'>): string {
  return getModificationColor(modification.normalizedName || modification.category)
}

function getModificationColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return MOD_COLOR_PALETTE[hash % MOD_COLOR_PALETTE.length] ?? '#f4c145'
}
