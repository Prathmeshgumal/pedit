import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaItem } from '../../shared/model'
import { fmtTime } from '../../shared/time'
import { fontPath, runFfmpeg } from './ffmpeg'
import { TONEMAP_VF } from './color'

const hdr = (m: MediaItem): string[] => (m.colorTransfer === 'sdr' ? [] : [TONEMAP_VF])
const seek = (m: MediaItem, ms: number): string[] =>
  m.kind === 'image' ? [] : ['-ss', (Math.max(0, Math.min(ms, m.durationMs - 50)) / 1000).toFixed(3)]
/** Escape a value for use inside a single-quoted filter option. */
const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')

/** One upright frame of `media` at `sourceMs` as a jpg, at most `maxEdge` px on its long side (HDR is tone-mapped). */
export async function extractFrame(media: MediaItem, sourceMs: number, out: string, maxEdge = 1920): Promise<void> {
  const fit = `scale='if(gte(iw,ih),min(${maxEdge},iw),-2)':'if(gte(iw,ih),-2,min(${maxEdge},ih))'`
  await runFfmpeg([...seek(media, sourceMs), '-i', media.path, '-frames:v', '1', '-vf', [fit, ...hdr(media), 'format=yuvj420p'].join(','), '-q:v', '2', '-f', 'image2', out])
}

const CELL_W = 480, CELL_H = 270

/**
 * A grid of `count` evenly spaced frames (4 columns, 480px cells, each with its time burned in),
 * so Claude can see what happens in a clip in one image.
 */
export async function contactSheet(media: MediaItem, count = 12, out: string): Promise<{ path: string; times: number[] }> {
  const n = media.kind === 'image' ? 1 : Math.max(1, count)
  const times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * media.durationMs) / n))
  const dir = await mkdtemp(join(tmpdir(), 'pedit-sheet-'))
  try {
    const cell = (i: number): Promise<void> => runFfmpeg([...seek(media, times[i]), '-i', media.path, '-frames:v', '1', '-vf', [
      `scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=decrease`, ...hdr(media), `pad=${CELL_W}:${CELL_H}:(ow-iw)/2:(oh-ih)/2`,
      `drawtext=fontfile='${esc(fontPath())}':text='${esc(fmtTime(times[i]))}':x=8:y=h-th-8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
      'format=yuvj420p'
    ].join(','), '-q:v', '3', '-f', 'image2', join(dir, `c${String(i).padStart(3, '0')}.jpg`)])
    for (let i = 0; i < n; i += 4) await Promise.all(Array.from({ length: Math.min(4, n - i) }, (_, k) => cell(i + k)))
    const cols = Math.min(4, n), rows = Math.ceil(n / cols)
    await runFfmpeg(['-framerate', '1', '-i', join(dir, 'c%03d.jpg'), '-vf', `tile=${cols}x${rows}:padding=0,format=yuvj420p`, '-frames:v', '1', '-q:v', '3', '-f', 'image2', out])
    return { path: out, times }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
