import type { Aspect, ItemId, MediaItem, Project } from '../../shared/model'
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

/** Pure: the full ffmpeg argv for exporting p (original files, not proxies). Output goes to `<outPath>.part`. */
export function buildExportArgs(p: Project, o: ExportOptions, textPngs: Record<ItemId, string>, enc: EncoderInfo): string[] {
  const { width: W, height: H } = outputSize(o.aspect, o.resolution)
  const fps = resolveFps(p, o)
  const total = timelineDurationMs(p)
  const args: string[] = ['-hide_banner', '-y']
  const fc: string[] = []
  let n = 0
  const pairs: string[] = []

  for (const [i, v] of p.video.entries()) {
    const m = p.media.find((x) => x.id === v.mediaId)!
    const dur = sec(v.outMs - v.inMs)
    if (m.kind === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', dur, '-i', m.path)
    else args.push('-ss', sec(v.inMs), '-t', dur, '-i', m.path)
    // drop frames and shrink first: tone-mapping 4K120 HDR at full size is the slow part
    const vf = [`fps=${fps}`, ...transformFilters(v.transform ?? IDENTITY_TRANSFORM), `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, ...(isHdr(m) ? [TONEMAP_VF] : []), 'setsar=1', 'format=yuv420p', `trim=duration=${dur}`, 'setpts=PTS-STARTPTS']
    fc.push(`[${n}:v]${vf.join(',')}[v${i}]`)
    if (m.hasAudio && m.kind === 'video') fc.push(`[${n}:a]${AFMT},atrim=duration=${dur},apad=whole_dur=${dur},asetpts=PTS-STARTPTS,volume=${v.volume}[a${i}]`)
    else fc.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur},${AFMT}[a${i}]`)
    pairs.push(`[v${i}][a${i}]`)
    n++
  }
  fc.push(`${pairs.join('')}concat=n=${p.video.length}:v=1:a=1[cv0][ca]`)

  let vLabel = 'cv0'
  for (const [k, t] of p.text.filter((t) => textPngs[t.id] && t.startMs < total).entries()) {
    args.push('-loop', '1', '-framerate', String(fps), '-t', sec(total), '-i', textPngs[t.id])
    const out = `cv${k + 1}`
    fc.push(`[${vLabel}][${n}:v]overlay=0:0:eof_action=pass:enable='between(t,${sec(t.startMs)},${sec(t.startMs + t.durationMs)})'[${out}]`)
    vLabel = out
    n++
  }
  fc.push(`[${vLabel}]format=yuv420p[vout]`)

  let aLabel = 'ca'
  const music = p.audio.filter((a) => a.startMs < total)
  const musLabels: string[] = []
  for (const [k, a] of music.entries()) {
    const m = p.media.find((x) => x.id === a.mediaId)!
    const len = Math.min(a.outMs - a.inMs, total - a.startMs)
    args.push('-ss', sec(a.inMs), '-t', sec(len), '-i', m.path)
    fc.push(`[${n}:a]${AFMT},volume=${a.volume},adelay=${Math.round(a.startMs)}:all=1[mus${k}]`)
    musLabels.push(`[mus${k}]`)
    n++
  }
  if (musLabels.length) {
    fc.push(`[ca]${musLabels.join('')}amix=inputs=${musLabels.length + 1}:duration=first:normalize=0[amix]`)
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
