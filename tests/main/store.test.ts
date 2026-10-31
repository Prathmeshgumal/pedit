import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, copyFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../../src/main/project/store'
import { probe } from '../../src/main/media/probe'
import type { MediaItem } from '@shared/model'
import { f } from './fixtures'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pedit-store-'))

async function mediaAt(path: string): Promise<MediaItem> {
  return { ...(await probe(path)), id: 'm_000001', folder: 'day1', importIndex: 0, status: 'ready' }
}

describe('ProjectStore', () => {
  it('creates and reopens a project folder', async () => {
    const dir = join(tmp(), 'Trip.pedit')
    const s = await ProjectStore.create(dir, 'Trip')
    expect(s.project.name).toBe('Trip')
    expect(s.cacheDir).toBe(join(dir, 'cache'))
    const again = await ProjectStore.open(dir)
    expect(again.project).toEqual(s.project)
  })

  it('saves atomically without leaving temp files', async () => {
    const dir = join(tmp(), 'A.pedit')
    const s = await ProjectStore.create(dir, 'A')
    await s.save({ ...s.project, name: 'B' })
    expect(readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([])
    expect((await ProjectStore.open(dir)).project.name).toBe('B')
  })

  it('marks missing media offline and relinks it', async () => {
    const base = tmp()
    mkdirSync(join(base, 'm'))
    const copy = join(base, 'm', 'clip.mp4')
    copyFileSync(f('day1/h264_1080p30.mp4'), copy)
    const dir = join(base, 'P.pedit')
    const s = await ProjectStore.create(dir, 'P')
    const m = await mediaAt(copy)
    await s.save({ ...s.project, media: [m] })
    rmSync(copy)
    const opened = await ProjectStore.open(dir)
    expect(opened.project.media[0].status).toBe('offline')
    await opened.relink('m_000001', f('day1/h264_1080p30.mp4'))
    expect(opened.project.media[0]).toMatchObject({ status: 'processing', path: f('day1/h264_1080p30.mp4') })
    expect((await ProjectStore.open(dir)).project.media[0].status).toBe('processing')
  })

  it('persists chat entries and claude session id', async () => {
    const dir = join(tmp(), 'C.pedit')
    const s = await ProjectStore.create(dir, 'C')
    await s.appendChat({ at: '2026-10-31T10:00:00Z', role: 'user', text: 'hi' })
    await s.appendChat({ at: '2026-10-31T10:00:01Z', role: 'assistant', text: 'hello' })
    await s.setClaudeSessionId('sess-1')
    const o = await ProjectStore.open(dir)
    expect((await o.readChat()).map((e) => e.text)).toEqual(['hi', 'hello'])
    expect(o.claudeSessionId).toBe('sess-1')
  })

  it('refuses to open a folder that is not a project', async () => {
    const dir = tmp()
    await expect(ProjectStore.open(dir)).rejects.toThrow(/not a pedit project/)
    expect(existsSync(join(dir, 'project.json'))).toBe(false)
  })
})
