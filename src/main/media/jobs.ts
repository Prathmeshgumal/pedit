import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { MediaId, MediaItem } from '../../shared/model'
import type { IdGen } from '../../shared/ids'
import { runFfmpeg, type EncoderInfo } from './ffmpeg'
import { proxyArgs } from './proxy'
import { filmstripArgs, stillArgs, thumbArgs } from './thumbs'
import { buildWaveform } from './waveform'
import { probe } from './probe'

export { proxyArgs } from './proxy'

export type Stage = 'thumb' | 'filmstrip' | 'waveform' | 'proxy'
type Update = (id: MediaId, patch: Partial<MediaItem>) => void
type Progress = (id: MediaId, stage: Stage, pct: number) => void

const PATH_KEY: Record<Stage, keyof MediaItem> = { thumb: 'thumbPath', filmstrip: 'filmstripPath', waveform: 'waveformPath', proxy: 'proxyPath' }
let tmpSeq = 0
const EXT: Record<Stage, string> = { thumb: 'jpg', filmstrip: 'jpg', waveform: 'bin', proxy: 'mp4' }

async function cacheKey(path: string): Promise<string> {
  const st = await stat(path)
  return createHash('sha1').update(`${path}|${st.size}|${st.mtimeMs}`).digest('hex')
}

function stagesFor(m: MediaItem): Stage[] {
  if (m.kind === 'audio') return ['waveform']
  if (m.kind === 'image') return ['thumb', 'proxy'] // proxy = upright preview jpg
  // filmstrip is cut from the proxy: small frames with a keyframe every 0.5s make it fast
  return m.hasAudio ? ['thumb', 'waveform', 'proxy', 'filmstrip'] : ['thumb', 'proxy', 'filmstrip']
}

class Pool {
  private running = 0
  private queue: Array<{ id: MediaId; rank: () => number; run: () => Promise<void> }> = []
  constructor(private limit: number) {}
  push(id: MediaId, rank: () => number, run: () => Promise<void>): void { this.queue.push({ id, rank, run }); this.pump() }
  clear(): void { this.queue = [] }
  private pump(): void {
    while (this.running < this.limit && this.queue.length) {
      this.queue.sort((a, b) => a.rank() - b.rank())
      const job = this.queue.shift()!
      this.running++
      job.run().finally(() => { this.running--; this.pump() })
    }
  }
}

export class MediaPipeline {
  private light = new Pool(2)
  private heavy: Pool
  private priority = new Set<MediaId>()
  private order = new Map<MediaId, number>()
  private ac = new AbortController()

  constructor(private cacheDir: string, private enc: EncoderInfo, private update: Update, private onProgress: Progress) {
    this.heavy = new Pool(enc.h264.startsWith('lib') ? 2 : 1)
  }

  enqueue(m: MediaItem): void {
    this.order.set(m.id, Date.parse(m.createdAt) || 0)
    const stages = stagesFor(m)
    const patch: Partial<MediaItem> = {}
    const runStage = async (i: number): Promise<void> => {
      if (i >= stages.length) {
        this.update(m.id, { ...patch, status: 'ready' })
        return
      }
      const stage = stages[i]
      const next = (): void => {
        if (i + 1 < stages.length && stages[i + 1] === 'proxy') this.heavy.push(m.id, this.rank(m.id), () => runStage(i + 1))
        else void runStage(i + 1)
      }
      try {
        const out = await this.produce(m, stage, patch.proxyPath)
        ;(patch as Record<string, unknown>)[PATH_KEY[stage]] = out
        this.update(m.id, { [PATH_KEY[stage]]: out })
        this.onProgress(m.id, stage, 100)
        next()
      } catch (e) {
        if (this.ac.signal.aborted) return
        this.update(m.id, { status: 'error', error: `${stage} failed: ${(e as Error).message.slice(0, 500)}` })
      }
    }
    if (stages[0] === 'proxy') this.heavy.push(m.id, this.rank(m.id), () => runStage(0))
    else this.light.push(m.id, this.rank(m.id), () => runStage(0))
  }

  prioritize(ids: MediaId[]): void { for (const id of ids) this.priority.add(id) }

  cancelAll(): void {
    this.light.clear(); this.heavy.clear()
    this.ac.abort(); this.ac = new AbortController()
  }

  private rank(id: MediaId): () => number {
    return () => (this.priority.has(id) ? -1e15 : 0) + (this.order.get(id) ?? 0)
  }

  private async produce(m: MediaItem, stage: Stage, proxyFor?: string): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true })
    const ext = stage === 'proxy' && m.kind === 'image' ? 'jpg' : EXT[stage]
    const out = join(this.cacheDir, `${await cacheKey(m.path)}.${stage}.${ext}`)
    if (existsSync(out)) return out
    // unique per job, so two jobs for the same file never delete each other's half-written output
    const tmp = `${out}.${process.pid}-${++tmpSeq}.tmp.${ext}`
    const signal = this.ac.signal
    const pct = (ms: number): void => this.onProgress(m.id, stage, Math.min(99, Math.round((ms / Math.max(1, m.durationMs)) * 100)))
    try {
      if (stage === 'thumb') await runFfmpeg(thumbArgs(m, tmp), { signal })
      else if (stage === 'filmstrip') await runFfmpeg(filmstripArgs({ ...m, path: proxyFor ?? m.path, colorTransfer: proxyFor ? 'sdr' : m.colorTransfer }, tmp), { signal })
      else if (stage === 'waveform') await buildWaveform(m.path, tmp, signal)
      else if (m.kind === 'image') await runFfmpeg(stillArgs(m, tmp), { signal })
      else {
        try {
          await runFfmpeg(proxyArgs(m, tmp, this.enc), { signal, onProgress: pct })
        } catch (e) {
          if (signal.aborted || !this.enc.hwaccel.length) throw e
          await runFfmpeg(proxyArgs(m, tmp, this.enc, { hwDecode: false }), { signal, onProgress: pct })
        }
      }
      await rename(tmp, out)
      return out
    } finally {
      await rm(tmp, { force: true })
    }
  }
}

const MEDIA_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.m2ts', '.3gp', '.insv',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus',
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'])

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.pedit')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (MEDIA_EXT.has(extname(e.name).toLowerCase())) out.push(p)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]) }
  }))
  return res
}

export async function importPaths(paths: string[], existingMedia: MediaItem[], ids: IdGen): Promise<MediaItem[]> {
  const known = new Set(existingMedia.map((m) => resolve(m.path)))
  const found: Array<{ path: string; folder: string }> = []
  for (const raw of paths) {
    const root = resolve(raw)
    const st = await stat(root)
    if (st.isDirectory()) {
      const files: string[] = []
      await walk(root, files)
      for (const p of files) {
        const rel = relative(root, dirname(p))
        found.push({ path: p, folder: rel === '' ? basename(root) : rel.split(sep).join('/') })
      }
    } else found.push({ path: root, folder: basename(dirname(root)) })
  }
  const fresh = found.filter((x, i) => !known.has(x.path) && found.findIndex((y) => y.path === x.path) === i)
  let next = existingMedia.reduce((n, m) => Math.max(n, m.importIndex + 1), 0)
  const probed = await mapLimit(fresh, 4, async (x) => {
    try { return { x, info: await probe(x.path) } } catch { return null }
  })
  const items: MediaItem[] = []
  for (const r of probed) {
    if (!r) continue
    items.push({ ...r.info, id: ids('m'), folder: r.x.folder, importIndex: next++, status: 'processing' })
  }
  return items
}
