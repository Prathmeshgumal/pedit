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
import { TONEMAP_VF } from '../../src/main/media/color'

let enc: EncoderInfo
const media = async (rel: string, id: string): Promise<MediaItem> => ({ ...(await probe(f(rel))), id, folder: '', importIndex: 0, status: 'ready' })

/** Stand-in for the renderer: a transparent full frame with a white box in the middle (the "text"). */
async function fakeText(items: TextItem[], w: number, h: number, dir: string, color = 'white'): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const t of items) {
    const p = join(dir, `${t.id}.png`)
    execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${w}x${h},format=rgba`,
      '-f', 'lavfi', '-i', `color=c=${color}:s=400x120,format=rgba`,
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

  it('text keeps its colour in the exported file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const p = await reel(); p.video = [p.video[1]]; p.video[0].startMs = 0; p.audio = []
    const out = join(dir, 'col.mp4')
    await runExport(p, { aspect: '16:9', resolution: 1080, fps: 30, quality: 'high', outPath: out },
      { renderTextPngs: (i, w, h) => fakeText(i, w, h, dir, '0x00c000'), enc, onProgress: () => {}, signal: new AbortController().signal })
    // decode the way a player does for a file tagged bt709
    const rgb = execFileSync(ffmpegPath(), ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 })
    const px = (1080 / 2) * 1920 + 1920 / 2
    const [r, g, b] = [rgb[px * 3], rgb[px * 3 + 1], rgb[px * 3 + 2]]
    expect(Math.abs(g - 0xc0)).toBeLessThan(6)
    expect(r).toBeLessThan(8)
    expect(b).toBeLessThan(8)
  }, 120000)

  it('text animations move and fade the text in the exported file like the preview', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const black = join(dir, 'black.mp4')
    execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=2', '-pix_fmt', 'yuv420p', black])
    const p = emptyProject('anim')
    p.media = [await media(black, 'mb')]
    p.video = [{ id: 'c1', mediaId: 'mb', startMs: 0, inMs: 0, outMs: 2000, volume: 1 }]
    p.text = [{ id: 't1', startMs: 0, durationMs: 2000, text: 'x', style: { font: 'Inter', bold: true, sizePct: 8, color: '#ffffff', position: 'center', background: null, animIn: 'slide-up', animMs: 1000 } }]
    const out = join(dir, 'anim.mp4')
    await runExport(p, { aspect: '16:9', resolution: 1080, fps: 30, quality: 'high', outPath: out },
      { renderTextPngs: async (i, w, h) => Object.fromEntries(Object.entries(await fakeText(i, w, h, dir)).map(([k, v]) => [k, { path: v, cx: w / 2, cy: h / 2 }])), enc, onProgress: () => {}, signal: new AbortController().signal })
    // at 0.25s: a quarter faded in, still ~36px below its place (box is rows 480..600 when settled)
    const g = grayFrame(out, 0.25, 1920, 1080)
    expect(regionMean(g, 1920, 900, 486, 120, 24)).toBeLessThan(12) // top of the settled box: not reached yet
    const low = regionMean(g, 1920, 900, 604, 120, 24) // below the settled box: the text is still here
    expect(low).toBeGreaterThan(35); expect(low).toBeLessThan(110)
    // at 1.5s it has arrived and is fully visible
    const g2 = grayFrame(out, 1.5, 1920, 1080)
    expect(regionMean(g2, 1920, 900, 486, 120, 24)).toBeGreaterThan(200)
    expect(regionMean(g2, 1920, 900, 610, 120, 20)).toBeLessThan(12)
  }, 120000)

  it('filters and adjustments change the colour of the exported clip; vignette darkens the corners', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const src = join(dir, 'orange.mp4')
    execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xd07030:s=1920x1080:r=30:d=1', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', src])
    const p = emptyProject('look')
    p.media = [await media(src, 'mo')]
    p.video = [
      { id: 'c1', mediaId: 'mo', startMs: 0, inMs: 0, outMs: 1000, volume: 1, look: { filter: { name: 'Black & white', strength: 1, adjust: { saturation: -100 } } } },
      { id: 'c2', mediaId: 'mo', startMs: 1000, inMs: 0, outMs: 1000, volume: 1, look: { adjust: { vignette: 100 } } },
      { id: 'c3', mediaId: 'mo', startMs: 2000, inMs: 0, outMs: 1000, volume: 1 }
    ]
    const out = join(dir, 'look.mp4')
    await runExport(p, { aspect: '16:9', resolution: 1080, fps: 30, quality: 'high', outPath: out },
      { renderTextPngs: async () => ({}), enc, onProgress: () => {}, signal: new AbortController().signal, tempDir: dir })
    const rgbAt = (t: number, x: number, y: number): number[] => {
      const rgb = execFileSync(ffmpegPath(), ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 })
      const i = (y * 1920 + x) * 3
      return [rgb[i], rgb[i + 1], rgb[i + 2]]
    }
    const bw = rgbAt(0.5, 960, 540)
    expect(Math.max(...bw) - Math.min(...bw)).toBeLessThan(6) // grey
    const plain = rgbAt(2.5, 960, 540)
    expect(plain[0] - plain[2]).toBeGreaterThan(120) // still orange
    const vigCentre = rgbAt(1.5, 960, 540), vigCorner = rgbAt(1.5, 4, 4)
    expect(Math.abs(vigCentre[0] - plain[0])).toBeLessThan(8)
    expect(vigCorner[0]).toBeLessThan(plain[0] * 0.2)
  }, 120000)

  it('fast HDR export looks the same as tone-mapping at full size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const p = await reel(); p.video = [p.video[0]]; p.text = []; p.audio = []
    const out = join(dir, 'hdr.mp4')
    await runExport(p, { aspect: '16:9', resolution: 1080, fps: 30, quality: 'high', outPath: out },
      { renderTextPngs: async () => ({}), enc, onProgress: () => {}, signal: new AbortController().signal })
    const ref = execFileSync(ffmpegPath(), ['-v', 'error', '-ss', '1', '-i', f('day1/hevc_4k120_hlg.mov'), '-frames:v', '1',
      '-vf', `${TONEMAP_VF},scale=1920:1080`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 })
    const got = grayFrame(out, 1.0, 1920, 1080)
    let d = 0; for (let i = 0; i < got.length; i += 53) d += Math.abs(got[i] - ref[i])
    expect(d / (got.length / 53)).toBeLessThan(6)
  }, 120000)

  it('a photo rotated 90 degrees exports with its left edge on top', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pedit-exp-'))
    const p = emptyProject('rot')
    p.media = [await media('photos/landscape.jpg', 'm1')]
    p.video = [{ id: 'c1', mediaId: 'm1', startMs: 0, inMs: 0, outMs: 1000, volume: 1, transform: { rotate: 90, flipH: false, flipV: false, crop: { x: 0, y: 0, w: 1, h: 1 } } }]
    const out = join(dir, 'rot.mp4')
    await runExport(p, { aspect: '9:16', resolution: 1080, fps: 30, quality: 'standard', outPath: out },
      { renderTextPngs: async () => ({}), enc, onProgress: () => {}, signal: new AbortController().signal })
    const rgb = (y: number): Buffer => execFileSync(ffmpegPath(), ['-v', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-vf', `crop=8:8:536:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    // landscape.jpg has a red strip on its left quarter; turned clockwise, the left side moves to the top
    expect(rgb(100)[0]).toBeGreaterThan(180)
    expect(rgb(1700)[2]).toBeGreaterThan(150)
  }, 60000)

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
