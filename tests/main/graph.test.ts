import { describe, it, expect } from 'vitest'
import { emptyProject, type MediaItem, type Project } from '@shared/model'
import { TONEMAP_VF } from '../../src/main/media/color'
import { buildExportArgs, missingMedia, outputSize, resolveFps, type ExportOptions } from '../../src/main/export/graph'

const NV = { h264: 'h264_nvenc', hevc: 'hevc_nvenc', hwaccel: ['cuda'] }
const X264 = { h264: 'libx264', hevc: 'libx265', hwaccel: [] }
const m = (id: string, over: Partial<MediaItem>): MediaItem => ({
  id, path: `/v/${id}.mov`, name: `${id}.mov`, folder: '', kind: 'video', createdAt: '2026-01-01T00:00:00Z', importIndex: 0,
  durationMs: 5000, width: 1920, height: 1080, fps: 30, codec: 'h264', bitDepth: 8, colorTransfer: 'sdr', hasAudio: true, rotation: 0, status: 'ready', ...over
})
function project(): Project {
  const p = emptyProject('t')
  p.media = [m('hlg', { colorTransfer: 'hlg', fps: 120, codec: 'hevc', width: 3840, height: 2160 }), m('uni', { path: "/v/Tōkyō day 1 'final'.mov", hasAudio: false })]
  p.video = [
    { id: 'c1', mediaId: 'hlg', startMs: 0, inMs: 0, outMs: 3000, volume: 0.5 },
    { id: 'c2', mediaId: 'uni', startMs: 3000, inMs: 0, outMs: 2000, volume: 1 }
  ]
  return p
}
const O: ExportOptions = { aspect: '9:16', resolution: 1080, fps: 30, quality: 'standard', outPath: '/out/x.mp4' }
const count = (s: string, sub: string): number => s.split(sub).length - 1

describe('export graph', () => {
  it('sizes the output by short edge', () => {
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize('16:9', 2160)).toEqual({ width: 3840, height: 2160 })
    expect(outputSize('1:1', 1080)).toEqual({ width: 1080, height: 1080 })
  })
  it('resolves source fps to the lowest used clip fps, capped at 120', () => {
    expect(resolveFps(project(), { ...O, fps: 'source' })).toBe(30)
    const p = project(); p.video = [p.video[0]]
    expect(resolveFps(p, { ...O, fps: 'source' })).toBe(120)
    expect(resolveFps(p, { ...O, fps: 60 })).toBe(60)
  })
  it('tonemaps HDR once and fills silent clips with anullsrc once', () => {
    const args = buildExportArgs(project(), O, {}, NV)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(count(fc, TONEMAP_VF)).toBe(1)
    expect(count(fc, 'anullsrc')).toBe(1)
    // 4K120 HDR: frames are dropped and shrunk before the slow tone-mapping
    const hdr = fc.split(';')[0]
    expect(hdr.indexOf('fps=')).toBeLessThan(hdr.indexOf(TONEMAP_VF))
    expect(hdr.indexOf('crop=')).toBeLessThan(hdr.indexOf(TONEMAP_VF))
    expect(fc).toContain('concat=n=2:v=1:a=1')
    expect(fc).toContain('volume=0.5')
    expect(args).toContain("/v/Tōkyō day 1 'final'.mov") // separate argv entry, no shell quoting
    expect(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2)).toEqual(['-c:v', 'h264_nvenc'])
    expect(args).toContain('16M')
    expect(args.at(-1)).toBe('/out/x.mp4.part')
  })
  it('overlays text pngs only during their time and mixes music', () => {
    const p = project()
    p.text = [{ id: 't1', startMs: 500, durationMs: 1500, text: 'Hi', style: { font: 'Inter', bold: true, sizePct: 8, color: '#fff', position: 'center', background: null } }]
    p.media.push(m('mus', { kind: 'audio', width: 0, height: 0, fps: 0 }))
    p.audio = [{ id: 'a1', mediaId: 'mus', startMs: 0, inMs: 1000, outMs: 9000, volume: 0.8 }]
    const args = buildExportArgs(p, { ...O, quality: 'high', resolution: 2160 }, { t1: '/tmp/t1.png' }, X264)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain("enable='between(t,0.5,2)'")
    expect(fc).toContain('amix=inputs=2:duration=first:normalize=0')
    expect(args).toContain('/tmp/t1.png')
    expect(args).toContain('-crf'); expect(args[args.indexOf('-crf') + 1]).toBe('16')
    expect(fc).toContain('crop=2160:3840')
  })
  it('lists offline media used on the timeline, but not media whose preview build failed', () => {
    const p = project(); p.media[1].status = 'offline'
    expect(missingMedia(p).map((x) => x.name)).toEqual(['uni.mov'])
    p.media[1].status = 'error'
    expect(missingMedia(p)).toEqual([])
  })
  it('mixes every music item after a split, each at its own time', () => {
    const p = project()
    p.media.push(m('mus', { kind: 'audio', width: 0, height: 0, fps: 0 }))
    p.audio = [
      { id: 'a1', mediaId: 'mus', startMs: 0, inMs: 0, outMs: 2000, volume: 1 },
      { id: 'a2', mediaId: 'mus', startMs: 3000, inMs: 2000, outMs: 4000, volume: 0.5 }
    ]
    const args = buildExportArgs(p, O, {}, NV)
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(count(fc, 'adelay=')).toBe(2)
    expect(fc).toContain('adelay=3000:all=1')
    expect(fc).toContain('amix=inputs=3:duration=first:normalize=0')
    expect(args.filter((a) => a === '/v/mus.mov')).toHaveLength(2)
  })
})
