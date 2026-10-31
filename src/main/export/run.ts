import { existsSync } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { timelineDurationMs, type ItemId, type Project, type TextItem } from '../../shared/model'
import { runFfmpeg, type EncoderInfo } from '../media/ffmpeg'
import { buildExportArgs, missingMedia, outputSize, type ExportOptions } from './graph'

export type { ExportOptions } from './graph'

export interface ExportDeps {
  renderTextPngs: (items: TextItem[], w: number, h: number) => Promise<Record<ItemId, string>>
  enc: EncoderInfo
  onProgress: (pct: number) => void
  signal: AbortSignal
}

export async function runExport(p: Project, o: ExportOptions, deps: ExportDeps): Promise<void> {
  const total = timelineDurationMs(p)
  if (p.video.length === 0 || total <= 0) throw new Error('The timeline is empty: add a clip before exporting.')
  const used = new Set([...p.video, ...p.audio].map((i) => i.mediaId))
  const missing = [...missingMedia(p), ...p.media.filter((m) => used.has(m.id) && m.status !== 'offline' && m.status !== 'error' && !existsSync(m.path))]
  if (missing.length) throw new Error(`Missing media: ${[...new Set(missing.map((m) => m.name))].join(', ')}. Relink or remove these clips first.`)

  const { width, height } = outputSize(o.aspect, o.resolution)
  const texts = p.text.filter((t) => t.startMs < total)
  const pngs = await deps.renderTextPngs(texts, width, height)
  const part = `${o.outPath}.part`
  deps.onProgress(0)
  try {
    await runFfmpeg(buildExportArgs(p, o, pngs, deps.enc), {
      signal: deps.signal,
      onProgress: (ms) => deps.onProgress(Math.min(99, Math.floor((ms / total) * 100)))
    })
    if (deps.signal.aborted) throw new Error('Export cancelled')
    await rename(part, o.outPath)
    deps.onProgress(100)
  } catch (e) {
    await rm(part, { force: true })
    throw deps.signal.aborted ? new Error('Export cancelled') : e
  }
}

/** Temp directory for this export's text PNGs. */
export const exportTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'pedit-text-'))
