import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { buildLut, isNeutral, lookKey, parseCube, toCube, vignetteOf, type Cube } from '../../shared/look'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { timelineDurationMs, type ItemId, type Project, type TextItem } from '../../shared/model'
import { runFfmpeg, type EncoderInfo } from '../media/ffmpeg'
import { buildExportArgs, missingMedia, outputSize, type ClipLookFiles, type ExportOptions, type TextPng } from './graph'

export type { ExportOptions } from './graph'

export interface ExportDeps {
  renderTextPngs: (items: TextItem[], w: number, h: number) => Promise<Record<ItemId, TextPng>>
  enc: EncoderInfo
  onProgress: (pct: number) => void
  signal: AbortSignal
  /** Where to write the clips' LUT files (default: a new temp dir). */
  tempDir?: string
}

/** Bake each clip's look into a .cube file (one per distinct look) for ffmpeg's lut3d. */
export async function writeLookFiles(p: Project, dir: string): Promise<Record<ItemId, ClipLookFiles>> {
  const out: Record<ItemId, ClipLookFiles> = {}
  const byKey = new Map<string, string>()
  const cubes: Record<string, Cube> = {}
  for (const v of p.video) {
    const vig = vignetteOf(v.look)
    if (isNeutral(v.look) && !vig) continue
    let cube: string | null = null
    if (!isNeutral(v.look)) {
      const key = lookKey(v.look)
      cube = byKey.get(key) ?? null
      if (!cube) {
        const lut = v.look!.filter?.lut
        if (lut && !cubes[lut]) {
          try { cubes[lut] = parseCube(await readFile(lut, 'utf8')) } catch (e) { throw new Error(`The LUT file of filter "${v.look!.filter!.name}" can't be read (${(e as Error).message}).`) }
        }
        cube = join(dir, `look-${byKey.size}.cube`)
        await writeFile(cube, toCube(buildLut(v.look!, cubes)))
        byKey.set(key, cube)
      }
    }
    out[v.id] = { cube, vignette: vig }
  }
  return out
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
  const looks = await writeLookFiles(p, deps.tempDir ?? await mkdtemp(join(tmpdir(), 'pedit-look-')))
  const part = `${o.outPath}.part`
  deps.onProgress(0)
  try {
    const encode = (enc: EncoderInfo): Promise<void> => runFfmpeg(buildExportArgs(p, o, pngs, enc, looks), {
      signal: deps.signal,
      onProgress: (ms) => deps.onProgress(Math.min(99, Math.floor((ms / total) * 100)))
    })
    try {
      await encode(deps.enc)
    } catch (e) {
      // a hardware encoder that can't take this graph (VAAPI/QSV need surface uploads): retry once in software
      if (deps.signal.aborted || deps.enc.h264 === 'libx264') throw e
      await rm(part, { force: true })
      deps.onProgress(0)
      await encode({ ...deps.enc, h264: 'libx264' })
    }
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
