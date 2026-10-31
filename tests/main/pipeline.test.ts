import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaItem, MediaId } from '@shared/model'
import { seqIds } from '@shared/ids'
import { proxyArgs, MediaPipeline, importPaths } from '../../src/main/media/jobs'
import { parseRange } from '../../src/main/media/protocol'
import { detectEncoders, ffprobePath, ffmpegPath as ffmpegPathForTest, type EncoderInfo } from '../../src/main/media/ffmpeg'
import { probe } from '../../src/main/media/probe'
import { FIX, f } from './fixtures'

const NV: EncoderInfo = { h264: 'h264_nvenc', hevc: 'hevc_nvenc', hwaccel: ['cuda'] }
const X264: EncoderInfo = { h264: 'libx264', hevc: 'libx265', hwaccel: [] }

async function media(rel: string, id = 'm_000001'): Promise<MediaItem> {
  return { ...(await probe(f(rel))), id, folder: '', importIndex: 0, status: 'processing' }
}

function runPipeline(cacheDir: string, enc: EncoderInfo, m: MediaItem): Promise<{ item: MediaItem; stages: string[] }> {
  return new Promise((resolve, reject) => {
    let item = { ...m }
    const stages: string[] = []
    const pipe = new MediaPipeline(
      cacheDir, enc,
      (_id: MediaId, patch) => {
        item = { ...item, ...patch }
        if (item.status === 'ready') resolve({ item, stages })
        if (item.status === 'error') reject(new Error(item.error))
      },
      (_id, stage, pct) => { if (pct === 100) stages.push(stage) }
    )
    pipe.enqueue(m)
  })
}

describe('proxyArgs', () => {
  it('tone-maps HLG 4K120 down to 60fps with half-second GOP and no B-frames', async () => {
    const a = proxyArgs(await media('day1/hevc_4k120_hlg.mov'), '/tmp/o.mp4', NV).join(' ')
    expect(a).toContain('zscale')
    expect(a).toContain('fps=60')
    expect(a).toMatch(/-g 30\b/)
    expect(a).toMatch(/-bf 0\b/)
    expect(a).toContain('-c:v h264_nvenc')
    expect(a).toContain('-hwaccel cuda')
  })
  it('keeps SDR 1080p30 untouched by tonemapping, GOP 15, cpu encoder', async () => {
    const a = proxyArgs(await media('day1/h264_1080p30.mp4'), '/tmp/o.mp4', X264).join(' ')
    expect(a).not.toContain('zscale')
    expect(a).toMatch(/-g 15\b/)
    expect(a).toContain('-c:v libx264')
    expect(a).not.toContain('-hwaccel')
  })
})

describe('MediaPipeline', () => {
  let enc: EncoderInfo
  beforeAll(async () => { enc = await detectEncoders() })

  it('builds thumb, filmstrip, waveform and a seek-friendly proxy for 4K120 HLG', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'pedit-cache-'))
    const { item, stages } = await runPipeline(cache, enc, await media('day1/hevc_4k120_hlg.mov'))
    expect(stages).toEqual(['thumb', 'waveform', 'proxy', 'filmstrip'])
    for (const p of [item.thumbPath, item.filmstripPath, item.waveformPath, item.proxyPath]) expect(existsSync(p!)).toBe(true)
    const px = await probe(item.proxyPath!)
    expect(px.codec).toBe('h264')
    expect(px.width).toBeLessThanOrEqual(960)
    expect(px.fps).toBe(60)
    const keys = execFileSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', item.proxyPath!])
      .toString().trim().split('\n').map(Number)
    const gaps = keys.slice(1).map((k, i) => k - keys[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.51)
    const peaks = readFileSync(item.waveformPath!)
    expect(peaks.byteLength / 4).toBeGreaterThanOrEqual(490) // ~100 peaks/s * 5s
  })

  it('handles unicode and quote filenames', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'pedit-cache-'))
    const { item } = await runPipeline(cache, enc, await media("day1/Tōkyō day 1 'final'.mov"))
    expect(item.status).toBe('ready')
  })

  it('prepares a photo: thumbnail and an upright preview image', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'pedit-cache-'))
    const { item, stages } = await runPipeline(cache, enc, await media('photos/rotated_exif6.jpg'))
    expect(stages).toEqual(['thumb', 'proxy'])
    expect(item.proxyPath!.endsWith('.jpg')).toBe(true)
    expect(await probe(item.proxyPath!)).toMatchObject({ kind: 'image', width: 200, height: 400 })
  })

  it('prepares a very short clip (a quarter second)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'pedit-short-'))
    const clip = join(d, 'short.mp4')
    execFileSync(ffmpegPathForTest(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30', '-t', '0.25', '-c:v', 'libx264', '-g', '250', clip])
    const { item } = await runPipeline(mkdtempSync(join(tmpdir(), 'pedit-cache-')), enc, { ...(await probe(clip)), id: 'm_1', folder: '', importIndex: 0, status: 'processing' })
    expect(existsSync(item.filmstripPath!)).toBe(true)
  })

  it('reuses cached outputs on a second run', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'pedit-cache-'))
    const m = await media('day1/h264_1080p30.mp4')
    const first = await runPipeline(cache, enc, m)
    const before = statSync(first.item.proxyPath!).mtimeMs
    const t0 = Date.now()
    const second = await runPipeline(cache, enc, m)
    expect(statSync(second.item.proxyPath!).mtimeMs).toBe(before)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('importPaths', () => {
  it('imports photos from folders and as single files', async () => {
    const d = mkdtempSync(join(tmpdir(), 'pedit-img-'))
    execFileSync(ffmpegPathForTest(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', join(d, 'photo.jpg')])
    expect((await importPaths([d], [], seqIds())).map((m) => [m.name, m.kind])).toEqual([['photo.jpg', 'image']])
    expect(await importPaths([f('photos/square.png')], [], seqIds())).toHaveLength(1)
  })
  it('expands folders, probes media and records folder names', async () => {
    const items = await importPaths([FIX], [], seqIds())
    expect(items).toHaveLength(9)
    expect(new Set(items.map((i) => i.folder))).toEqual(new Set(['day1', 'day2', 'music', 'bench', 'photos']))
    expect(items.map((i) => i.importIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(items.every((i) => i.status === 'processing')).toBe(true)
  })
  it('skips already-imported paths and continues importIndex', async () => {
    const first = await importPaths([f('day1')], [], seqIds())
    const again = await importPaths([FIX], first, seqIds())
    expect(again).toHaveLength(6) // everything except the 3 day1 clips
    expect(again[0].importIndex).toBe(3)
  })
})

describe('parseRange', () => {
  it('parses byte ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=2000-', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeUndefined()
  })
})
