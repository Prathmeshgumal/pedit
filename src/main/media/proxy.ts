import type { MediaItem } from '../../shared/model'
import type { EncoderInfo } from './ffmpeg'
import { TONEMAP_VF } from './color'

export const proxyFps = (m: MediaItem): number => Math.min(m.fps > 0 ? m.fps : 30, 60)
const isHdr = (m: MediaItem): boolean => m.colorTransfer === 'hlg' || m.colorTransfer === 'pq'

function encoderOpts(enc: string): string[] {
  if (enc.endsWith('_nvenc')) return ['-preset', 'p4', '-rc', 'vbr', '-cq', '28', '-b:v', '4M', '-maxrate', '8M']
  if (enc.endsWith('_qsv')) return ['-global_quality', '28', '-pix_fmt', 'nv12']
  if (enc.endsWith('_vaapi')) return ['-qp', '28']
  if (enc.endsWith('_videotoolbox')) return ['-b:v', '4M']
  return ['-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p']
}

/** Arguments for building a seek-friendly preview proxy (no leading global flags; see runFfmpeg). */
export function proxyArgs(m: MediaItem, out: string, enc: EncoderInfo, opts: { hwDecode?: boolean } = {}): string[] {
  const fps = proxyFps(m)
  const vaapi = enc.h264.endsWith('_vaapi')
  const filters = [
    ...(isHdr(m) ? [TONEMAP_VF] : []),
    `fps=${fps}`,
    "scale='if(gte(iw,ih),960,-2)':'if(gte(iw,ih),-2,960)'",
    vaapi ? 'format=nv12,hwupload' : 'format=yuv420p'
  ]
  const hw = opts.hwDecode !== false && enc.hwaccel.includes('cuda') ? ['-hwaccel', 'cuda'] : []
  return [
    ...(vaapi && enc.vaapiDevice ? ['-vaapi_device', enc.vaapiDevice] : []),
    ...hw,
    '-i', m.path,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', filters.join(','),
    '-c:v', enc.h264, ...encoderOpts(enc.h264),
    '-g', String(Math.round(fps / 2)), '-bf', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4', out
  ]
}
