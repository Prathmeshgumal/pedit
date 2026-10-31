import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { detectEncoders, ffmpegPath, runFfmpeg } from '../../src/main/media/ffmpeg'
import { TONEMAP_VF } from '../../src/main/media/color'

describe('ffmpeg', () => {
  it('detects a usable h264 encoder listed by ffmpeg', async () => {
    const enc = await detectEncoders()
    const list = execFileSync(ffmpegPath(), ['-hide_banner', '-encoders']).toString()
    expect(enc.h264.length).toBeGreaterThan(0)
    expect(list).toContain(enc.h264)
    console.log('encoders', enc)
  })

  it('reports progress and aborts cleanly', async () => {
    const ac = new AbortController()
    let progressed = 0
    const p = runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=600', '-f', 'null', '-'], {
      signal: ac.signal,
      onProgress: (ms) => { progressed = ms; if (ms > 500) ac.abort() }
    })
    await expect(p).rejects.toThrow(/abort/i)
    expect(progressed).toBeGreaterThan(500)
    expect(execFileSync('sh', ['-c', 'pgrep -f "[t]estsrc2=s=640x360:r=30:d=600" || true']).toString().trim()).toBe('')
  })

  it('tonemap filter targets bt709', () => {
    expect(TONEMAP_VF).toContain('zscale')
    expect(TONEMAP_VF).toContain('t=bt709')
  })
})
