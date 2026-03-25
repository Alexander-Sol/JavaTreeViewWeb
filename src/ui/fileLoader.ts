import { parseCdt } from '../parsers/cdtParser'
import { parseTree } from '../parsers/treeParser'
import { buildDataModel } from '../model/dataModel'
import type { DataModel } from '../model/types'

export interface LoadedDataset {
  model: DataModel
  filename: string
}

/**
 * Load a DataModel from a FileList (drag-and-drop or file picker).
 * Accepts: one .cdt file + optional .gtr and/or .atr files.
 */
export async function loadFromFiles(files: FileList | File[]): Promise<LoadedDataset> {
  const fileArray = Array.from(files)

  let cdtFile: File | null = null
  let gtrFile: File | null = null
  let atrFile: File | null = null

  for (const f of fileArray) {
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext === 'cdt') cdtFile = f
    else if (ext === 'gtr') gtrFile = f
    else if (ext === 'atr') atrFile = f
  }

  if (!cdtFile) throw new Error('No .cdt file found. Please include a CDT file.')

  const [cdtText, gtrText, atrText] = await Promise.all([
    cdtFile.text(),
    gtrFile?.text() ?? Promise.resolve(null),
    atrFile?.text() ?? Promise.resolve(null),
  ])

  const cdtData = parseCdt(cdtText)
  const gtrData = gtrText ? parseTree(gtrText) : null
  const atrData = atrText ? parseTree(atrText) : null
  const model = buildDataModel(cdtData, gtrData, atrData)

  return { model, filename: cdtFile.name }
}

/**
 * Load a DataModel from URLs for bundled sample datasets.
 */
export async function loadFromUrls(
  cdtUrl: string,
  gtrUrl?: string,
  atrUrl?: string,
): Promise<LoadedDataset> {
  const [cdtRes, gtrRes, atrRes] = await Promise.all([
    fetch(cdtUrl),
    gtrUrl ? fetch(gtrUrl) : Promise.resolve(null),
    atrUrl ? fetch(atrUrl) : Promise.resolve(null),
  ])

  if (!cdtRes.ok) throw new Error(`Failed to fetch CDT: ${cdtRes.statusText}`)

  const [cdtText, gtrText, atrText] = await Promise.all([
    cdtRes.text(),
    gtrRes?.ok ? gtrRes.text() : Promise.resolve(null),
    atrRes?.ok ? atrRes.text() : Promise.resolve(null),
  ])

  const cdtData = parseCdt(cdtText)
  const gtrData = gtrText ? parseTree(gtrText) : null
  const atrData = atrText ? parseTree(atrText) : null
  const model = buildDataModel(cdtData, gtrData, atrData)

  const filename = cdtUrl.split('/').pop() ?? 'dataset.cdt'
  return { model, filename }
}

// ============================================================
// Sample dataset manifest
// ============================================================

export interface SampleDataset {
  name: string
  label: string
  files: string[]
}

export async function fetchSampleList(): Promise<SampleDataset[]> {
  const res = await fetch('/samples.json')
  if (!res.ok) throw new Error('Failed to fetch sample list')
  return res.json() as Promise<SampleDataset[]>
}

export function getSampleUrls(
  sample: SampleDataset,
): { cdtUrl: string; gtrUrl?: string; atrUrl?: string } {
  const base = '/sample-data'
  const cdt = sample.files.find((f) => f.endsWith('.cdt'))
  const gtr = sample.files.find((f) => f.endsWith('.gtr'))
  const atr = sample.files.find((f) => f.endsWith('.atr'))

  if (!cdt) throw new Error(`Sample "${sample.name}" has no CDT file`)

  return {
    cdtUrl: `${base}/${cdt}`,
    gtrUrl: gtr ? `${base}/${gtr}` : undefined,
    atrUrl: atr ? `${base}/${atr}` : undefined,
  }
}
