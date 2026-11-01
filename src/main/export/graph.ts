import type { Aspect, ItemId, MediaItem, Project } from '../../shared/model'
import { ffTextAnim } from '../../shared/textAnim'
import { vignetteAngle } from '../../shared/look'
import { transitionMs } from '../../shared/transitions'
import { clipAudioSegments } from '../../shared/clipAudio'
import { IDENTITY_TRANSFORM, timelineDurationMs } from '../../shared/model'
import { transformFilters } from '../../shared/transform'
import { TONEMAP_VF } from '../media/color'
import type { EncoderInfo } from '../media/ffmpeg'

import type { ExportOptions } from '../../shared/ipc'
export type { ExportOptions } from '../../shared/ipc'

export function outputSize(aspect: Aspect, resolution: 1080 | 2160): { width: number; height: number } {
  const long = Math.round((resolution * 16) / 9)
  if (aspect === '16:9') return { width: long, height: resolution }
  if (aspect === '9:16') return { width: resolution, height: long }
  return { width: resolution, height: resolution }
}

const usedMedia = (p: Project): MediaItem[] => {
  const ids = new Set([...p.video, ...p.audio].map((i) => i.mediaId))
  return p.media.filter((m) => ids.has(m.id))
}

export function resolveFps(p: Project, o: ExportOptions): number {
  if (o.fps !== 'source') return o.fps
  const fps = usedMedia(p).filter((m) => m.kind === 'video' && p.video.some((v) => v.mediaId === m.id)).map((m) => m.fps).filter((f) => f > 0)
  return fps.length ? Math.min(120, Math.round(Math.min(...fps) * 1000) / 1000) : 30
}

export function missingMedia(p: Project): MediaItem[] {
  // 'error' only means a preview/thumbnail build failed; export reads the original file, so only offline blocks it
  return usedMedia(p).filter((m) => m.status === 'offline')
}

const sec = (ms: number): string => String(Math.round(ms) / 1000)
const isHdr = (m: MediaItem): boolean => m.colorTransfer === 'hlg' || m.colorTransfer === 'pq'
const AFMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'

/** A rendered text image: the full-frame PNG, and the text block's centre (needed to scale it in place for 'pop'). */
export type TextPng = string | { path: string; cx: number; cy: number }

/** A clip's look for export: baked LUT file (null = colours unchanged) and vignette strength 0..1. */
export interface ClipLookFiles { cube: string | null; vignette: number }

/** Colour look filters, in RGB with BT.709 both ways (as the preview decodes HD video). */
export function lookFilters(l: ClipLookFiles | undefined): string[] {
  if (!l || (!l.cube && !l.vignette)) return []
  // inside '…' everything is literal except a quote, which closes, escapes and reopens
  const esc = (s: string): string => s.replace(/\\/g, '/').replace(/'/g, "'\\''")
  return ['scale=in_color_matrix=bt709:in_range=tv:out_range=pc', 'format=gbrp',
    ...(l.cube ? [`lut3d=file='${esc(l.cube)}':interp=tetrahedral`] : []),
    ...(l.vignette ? [`vignette=angle=${vignetteAngle(l.vignette).toFixed(4)}:dither=0`] : []),
    'scale=out_color_matrix=bt709:out_range=tv']
}

/** Graph being built: input args, filter chains, the next input number and the current video label. */
interface Graph { args: string[]; fc: string[]; n: number; vLabel: string }

/**
 * Video clips (framing, look, fit to W×H) joined by cuts and transitions, into g.vLabel.
 * `proxies`: read the small preview files (already tone-mapped) instead of the originals — for quick looks, not export.
 */
function clipsStage(g: Graph, p: Project, W: number, H: number, fps: number, looks: Record<ItemId, ClipLookFiles>, proxies = false): void {
  const { args, fc } = g
  for (const [i, v] of p.video.entries()) {
    const m = p.media.find((x) => x.id === v.mediaId)!
    const path = proxies && m.proxyPath ? m.proxyPath : m.path
    const hdr = isHdr(m) && path === m.path
    const dur = sec(v.outMs - v.inMs)
    if (m.kind === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', dur, '-i', path)
    else args.push('-ss', sec(v.inMs), '-t', dur, '-i', path)
    // drop frames and shrink first: tone-mapping 4K120 HDR at full size is the slow part
    const vf = [`fps=${fps}`, ...transformFilters(v.transform ?? IDENTITY_TRANSFORM), `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, ...(hdr ? [TONEMAP_VF] : []), ...lookFilters(looks[v.id]), 'setsar=1', 'format=yuv420p', `trim=duration=${dur}`, 'setpts=PTS-STARTPTS']
    fc.push(`[${g.n}:v]${vf.join(',')}[v${i}]`)
    g.n++
  }

  // plain cuts are joined with concat; a transition joins the runs with xfade at the incoming clip's start
  const runs: number[][] = []
  p.video.forEach((_v, i) => { if (i === 0 || transitionMs(p.video, i) > 0) runs.push([i]); else runs.at(-1)!.push(i) })
  const runLabel = runs.map((r, k) => {
    if (r.length === 1) return `v${r[0]}`
    fc.push(`${r.map((i) => `[v${i}]`).join('')}concat=n=${r.length}:v=1:a=0[run${k}]`)
    return `run${k}`
  })
  g.vLabel = runLabel[0]
  for (let k = 1; k < runs.length; k++) {
    const i = runs[k][0], v = p.video[i]
    fc.push(`[${g.vLabel}][${runLabel[k]}]xfade=transition=${v.transition!.type}:duration=${sec(transitionMs(p.video, i))}:offset=${sec(v.startMs)}[xf${k}]`)
    g.vLabel = `xf${k}`
  }
}

/** Text images overlaid on g.vLabel, with their animations. */
function textStage(g: Graph, p: Project, W: number, H: number, fps: number, textPngs: Record<ItemId, TextPng>): void {
  const total = timelineDurationMs(p)
  for (const [k, t] of p.text.filter((t) => textPngs[t.id] && t.startMs < total).entries()) {
    const png = textPngs[t.id]
    const file = typeof png === 'string' ? png : png.path
    const centre = typeof png === 'string' ? { cx: W / 2, cy: H / 2 } : { cx: png.cx, cy: png.cy }
    g.args.push('-loop', '1', '-framerate', String(fps), '-t', sec(total), '-i', file)
    const out = `cv${k + 1}`
    const an = ffTextAnim(t, W, H, centre)
    const pre = ['format=rgba', ...(an.scale ? [`scale=w='max(2,trunc(iw*${an.scale}))':h='max(2,trunc(ih*${an.scale}))':eval=frame`] : []), ...an.fades]
    const src = pre.length > 1 ? `[${g.n}:v]${pre.join(',')}[tx${k}];` : ''
    const input = src ? `[tx${k}]` : `[${g.n}:v]`
    g.fc.push(`${src}[${g.vLabel}]${input}overlay=x='${an.x}':y='${an.y}':eof_action=pass:enable='between(t,${sec(t.startMs)},${sec(t.startMs + t.durationMs)})'[${out}]`)
    g.vLabel = out
    g.n++
  }
}

/**
 * Pure: ffmpeg argv for a contact sheet of the finished picture at `times` (ms): the same clips, looks, transitions
 * and text as the export, from the preview files at a small size. Frames go left-to-right, top-to-bottom.
 */
export function buildSheetArgs(p: Project, times: number[], cell: { width: number; height: number }, cols: number, out: string,
  textPngs: Record<ItemId, TextPng>, looks: Record<ItemId, ClipLookFiles> = {}): string[] {
  const fps = 10
  const g: Graph = { args: ['-hide_banner', '-y'], fc: [], n: 0, vLabel: '' }
  clipsStage(g, p, cell.width, cell.height, fps, looks, true)
  textStage(g, p, cell.width, cell.height, fps, textPngs)
  const frames = [...new Set(times.map((t) => Math.round((t * fps) / 1000)))]
  const rows = Math.ceil(frames.length / cols)
  g.fc.push(`[${g.vLabel}]select='${frames.map((f) => `eq(n,${f})`).join('+')}',tile=${cols}x${rows}:padding=4:color=0x202024,format=yuvj420p[sheet]`)
  return [...g.args, '-filter_complex', g.fc.join(';'), '-map', '[sheet]', '-frames:v', '1', '-q:v', '4', '-f', 'image2', '-update', '1', out]
}

/** Pure: the full ffmpeg argv for exporting p (original files, not proxies). Output goes to `<outPath>.part`. */
export function buildExportArgs(p: Project, o: ExportOptions, textPngs: Record<ItemId, TextPng>, enc: EncoderInfo, looks: Record<ItemId, ClipLookFiles> = {}): string[] {
  const { width: W, height: H } = outputSize(o.aspect, o.resolution)
  const fps = resolveFps(p, o)
  const total = timelineDurationMs(p)
  const g: Graph = { args: ['-hide_banner', '-y'], fc: [], n: 0, vLabel: '' }
  const { args, fc } = g
  clipsStage(g, p, W, H, fps, looks)
  let n = g.n

  // each clip's sound is its own piece (fades for transitions, J/L cuts), mixed over a silent bed as long as the video
  fc.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${sec(total)},${AFMT}[abed]`)
  const mixIn = ['[abed]']
  for (const [j, a] of clipAudioSegments(p).entries()) {
    if (a.startMs >= total) continue
    const m = p.media.find((x) => x.id === a.mediaId)!
    const L = Math.min(a.outMs - a.inMs, total - a.startMs)
    args.push('-ss', sec(a.inMs), '-t', sec(L), '-i', m.path)
    const fades = [...(a.fadeInMs ? [`afade=t=in:d=${sec(a.fadeInMs)}:curve=tri`] : []), ...(a.fadeOutMs && a.outMs - a.inMs <= L ? [`afade=t=out:st=${sec(L - a.fadeOutMs)}:d=${sec(a.fadeOutMs)}:curve=tri`] : [])]
    fc.push(`[${n}:a]${AFMT},atrim=duration=${sec(L)},apad=whole_dur=${sec(L)},asetpts=PTS-STARTPTS,volume=${a.gain}${fades.map((f) => `,${f}`).join('')},adelay=${Math.round(a.startMs)}:all=1[ca${j}]`)
    mixIn.push(`[ca${j}]`)
    n++
  }

  g.n = n
  textStage(g, p, W, H, fps, textPngs)
  n = g.n
  fc.push(`[${g.vLabel}]format=yuv420p[vout]`)

  const music = p.audio.filter((a) => a.startMs < total)
  for (const [k, a] of music.entries()) {
    const m = p.media.find((x) => x.id === a.mediaId)!
    const len = Math.min(a.outMs - a.inMs, total - a.startMs)
    args.push('-ss', sec(a.inMs), '-t', sec(len), '-i', m.path)
    fc.push(`[${n}:a]${AFMT},volume=${a.volume},adelay=${Math.round(a.startMs)}:all=1[mus${k}]`)
    mixIn.push(`[mus${k}]`)
    n++
  }
  let aLabel = 'abed'
  if (mixIn.length > 1) {
    fc.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:duration=first:normalize=0[amix]`)
    aLabel = 'amix'
  }

  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', `[${aLabel}]`)
  const scale = o.resolution === 2160 ? 4 : 1
  if (enc.h264 === 'libx264') args.push('-c:v', 'libx264', '-crf', o.quality === 'high' ? '16' : '20', '-preset', 'medium', '-pix_fmt', 'yuv420p')
  else {
    const mbps = (o.quality === 'high' ? 35 : 16) * scale
    args.push('-c:v', enc.h264, '-b:v', `${mbps}M`, '-maxrate', `${Math.round(mbps * 1.5)}M`, '-bufsize', `${mbps * 2}M`, '-pix_fmt', 'yuv420p')
  }
  args.push('-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', '-t', sec(total), '-f', 'mp4', `${o.outPath}.part`)
  return args
}
