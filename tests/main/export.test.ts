import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyProject, type MediaItem, type Project, type TextItem } from '@shared/model'
import { detectEncoders, ffmpegPath, ffprobePath, type EncoderInfo } from '../../src/main/media/ffmpeg'
import { probe } from '../../src/main/media/probe'
import { runExport, type ExportOptions } from '../../src/main/export/run'
import { f } from './fixtures'

let enc: EncoderInfo
const media = async (rel: string, id: string): Promise<MediaItem> => ({ ...(await probe(f(rel))), id, folder: '', importIndex: 0, status: 'ready' })

/** Stand-in for the renderer: a transparent full frame with a white box in the middle (the "text"). */
async function fakeText(items: TextItem[], w: number, h: number, dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const t of items) {
    const p = join(dir, `${t.id}.png`)
    execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${w}x${h},format=rgba`,
      '-f', 'lavfi', '-i', 'color=c=white:s=400x120,format=rgba',
      '-filter_complex', `[0][1]overlay=${w / 2 - 200}:${h / 2 - 60}:format=rgb`, '-frames:v', '1', p])
    out[t.id] = p
  }
  return out
}

const probeJson = (p: string): { streams: Array<Record<string, string | number>>; format: { duration: string } } =>
  JSON.parse(execFileSync(ffprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p]).toString())

/** Gray pixels of the frame at t seconds. */
const grayFrame = (file: string, t: number, w: number, h: number): Buffer =>
  execFileSync(ffmpegPath(), ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 })
const regionMean = (g: Buffer, w: number, x0: number, y0: number, rw: number, rh: number): number => {
  let s = 0
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) s += g[y * w + x]
  return s / (rw * rh)
}

async function reel(): Promise<Project> {
  const p = emptyProject('reel')
  p.media = [await media('day1/hevc_4k120_hlg.mov', 'm1'), await media("day1/Tōkyō day 1 'final'.mov", 'm2'), await media('day2/portrait_rot90.mp4', 'm3'), await media('music/track_02.mp3', 'm4')]
  p.video = [
    { id: 'c1', mediaId: 'm1', startMs: 0, inMs: 0, outMs: 3000, volume: 1 },
    { id: 'c2', mediaId: 'm2', startMs: 3000, inMs: 0, outMs: 2000, volume: 1 },
    { id: 'c3', mediaId: 'm3', startMs: 5000, inMs: 0, outMs: 3000, volume: 1 }
  ]
  p.text = [{ id: 't1', startMs: 0, durationMs: 2000, text: 'Tokyo', style: { font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position: 'center', background: null } }]
  p.audio = [{ id: 'a1', mediaId: 'm4', startMs: 0, inMs: 0, outMs: 20000, volume: 0.5 }]
  return p
}

describe('runExport', () => {
  beforeAll(async () => { enc = await detectEncoders() })

  it('exports a 9:16 reel from the original files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const out = join(dir, 'reel.mp4')
    const o: ExportOptions = { aspect: '9:16', resolution: 1080, fps: 30, quality: 'standard', outPath: out }
    let last = 0
    await runExport(await reel(), o, { renderTextPngs: (i, w, h) => fakeText(i, w, h, dir), enc, onProgress: (p) => { last = p }, signal: new AbortController().signal })
    expect(last).toBe(100)
    expect(existsSync(out + '.part')).toBe(false)
    const j = probeJson(out)
    const v = j.streams.find((s) => s.codec_type === 'video')!
    const a = j.streams.find((s) => s.codec_type === 'audio')!
    expect([v.width, v.height, v.codec_name, v.r_frame_rate]).toEqual([1080, 1920, 'h264', '30/1'])
    expect(Math.abs(Number(j.format.duration) - 8)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(Number(a.duration) - Number(v.duration))).toBeLessThanOrEqual(0.05)

    // text box (white, centered) visible at 1.0s
    const g = grayFrame(out, 1.0, 1080, 1920)
    expect(regionMean(g, 1080, 1080 / 2 - 150, 1920 / 2 - 40, 300, 80)).toBeGreaterThan(235)

    // portrait segment is upright: same as ffmpeg's own autorotated render, different from the un-rotated one
    const ref = (noRotate: boolean): Buffer => execFileSync(ffmpegPath(), ['-v', 'error', ...(noRotate ? ['-noautorotate'] : []), '-ss', '1', '-i', f('day2/portrait_rot90.mp4'), '-frames:v', '1',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 })
    const got = grayFrame(out, 6.0, 1080, 1920)
    const diff = (b: Buffer): number => { let s = 0; for (let i = 0; i < got.length; i += 97) s += Math.abs(got[i] - b[i]); return s / (got.length / 97) }
    expect(diff(ref(false))).toBeLessThan(15)
    expect(diff(ref(true))).toBeGreaterThan(diff(ref(false)) * 2)
  }, 180000)

  it('falls back to libx264 when the hardware encoder fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const p = await reel(); p.video = [p.video[1]]; p.video[0].startMs = 0; p.text = []; p.audio = []
    const out = join(dir, 'fb.mp4')
    await runExport(p, { aspect: '16:9', resolution: 1080, fps: 30, quality: 'standard', outPath: out },
      { renderTextPngs: async () => ({}), enc: { h264: 'h264_vaapi', hevc: null, hwaccel: [] }, onProgress: () => {}, signal: new AbortController().signal })
    expect(probeJson(out).streams.find((s) => s.codec_type === 'video')!.codec_name).toBe('h264')
  }, 120000)

  it('refuses offline media and names the file', async () => {
    const p = await reel(); p.media[1].status = 'offline'
    const o: ExportOptions = { aspect: '16:9', resolution: 1080, fps: 30, quality: 'standard', outPath: join(tmpdir(), 'never.mp4') }
    await expect(runExport(p, o, { renderTextPngs: async () => ({}), enc, onProgress: () => {}, signal: new AbortController().signal }))
      .rejects.toThrow(/Tōkyō day 1 'final'\.mov/)
  })

  it('refuses an empty timeline', async () => {
    const o: ExportOptions = { aspect: '16:9', resolution: 1080, fps: 30, quality: 'standard', outPath: join(tmpdir(), 'never.mp4') }
    await expect(runExport(emptyProject('e'), o, { renderTextPngs: async () => ({}), enc, onProgress: () => {}, signal: new AbortController().signal })).rejects.toThrow(/empty/i)
  })

  it('cancelling leaves no output or .part file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const o: ExportOptions = { aspect: '16:9', resolution: 2160, fps: 60, quality: 'high', outPath: join(dir, 'c.mp4') }
    const ac = new AbortController()
    const run = runExport(await reel(), o, { renderTextPngs: (i, w, h) => fakeText(i, w, h, dir), enc, onProgress: (p) => { if (p > 5) ac.abort() }, signal: ac.signal })
    await expect(run).rejects.toThrow()
    expect(readdirSync(dir).filter((x) => x.startsWith('c.mp4'))).toEqual([])
  }, 120000)
})
