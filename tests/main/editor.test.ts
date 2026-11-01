import { describe, it, expect } from 'vitest'
import { mkdtempSync, copyFileSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Editor } from '../../src/main/editor'
import { f } from './fixtures'

const quiet = { state: () => {}, progress: () => {} }

describe('Editor.relink', () => {
  it('reads the new file again so length and rotation match it', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    mkdirSync(join(base, 'm'))
    const copy = join(base, 'm', 'clip.mp4')
    copyFileSync(f('day1/h264_1080p30.mp4'), copy)
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    await ed.importPaths([copy])
    const before = ed.state()!.real.media[0]
    rmSync(copy)
    await ed.relink(before.id, f('day2/portrait_rot90.mp4'))
    const after = ed.state()!.real.media[0]
    expect(after.id).toBe(before.id)
    expect(after.path).toBe(f('day2/portrait_rot90.mp4'))
    expect(after.rotation).not.toBe(before.rotation)
    expect(after.folder).toBe(before.folder)
    await ed.flush()
  }, 60000)

  it('marks the clip as failed when the new file is not a video', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    await ed.importPaths([f('day1/h264_1080p30.mp4')])
    const id = ed.state()!.real.media[0].id
    const bad = join(base, 'notes.mp4')
    copyFileSync(join(base, 'P.pedit', 'project.json'), bad)
    await ed.relink(id, bad)
    expect(ed.state()!.real.media[0]).toMatchObject({ status: 'error' })
    await ed.flush()
  }, 60000)

  it('re-reads failed items when a project opens, so photos once taken for videos become photos', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const dir = join(base, 'P.pedit')
    const first = new Editor(quiet)
    await first.newProject(dir, 'P')
    await first.importPaths([f('photos/landscape.jpg')])
    const id = first.state()!.real.media[0].id
    // what an older pedit saved for a photo
    first.apply({ type: 'updateMedia', id, patch: { kind: 'video', durationMs: 40, fps: 25, status: 'error', error: 'thumb failed' } })
    await first.flush()

    const ed = new Editor(quiet)
    await ed.openProject(dir)
    await expect.poll(() => ed.state()!.real.media[0].status, { timeout: 20000 }).toBe('ready')
    expect(ed.state()!.real.media[0]).toMatchObject({ kind: 'image', durationMs: 0 })
    await ed.flush()
  }, 60000)
})

describe('Editor tools for Claude', () => {
  it('look at media: a contact sheet for a video, the photo for a photo, nothing for audio', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    await ed.importPaths([f('day1/h264_1080p30.mp4'), f('photos/landscape.jpg')])
    const [v, p] = ed.state()!.real.media
    const sheet = await ed.lookAtMedia(v.id, 8)
    expect(Buffer.from(sheet.jpegBase64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(sheet.times).toHaveLength(8)
    const photo = await ed.lookAtMedia(p.id, 12)
    expect(photo.times).toBeNull()
    expect(photo.jpegBase64.length).toBeGreaterThan(100)
    await ed.close()
  }, 60000)

  it("Claude's freeze frame goes into its draft, checked against the revision it read", async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    await ed.importPaths([f('day1/h264_1080p30.mp4')])
    ed.apply({ type: 'addClip', mediaId: ed.state()!.real.media[0].id })
    const rev = ed.state()!.viewRevision
    await expect(ed.freezeFrame('c_nope', 1000, 3000, 'claude', rev - 1)).rejects.toThrow(/timeline changed/)
    const clipId = ed.state()!.real.video[0].id
    await ed.freezeFrame(clipId, 2000, 2000, 'claude', rev)
    const st = ed.state()!
    expect(st.draftActive).toBe(true)
    expect(st.view.video).toHaveLength(3)
    expect(st.real.video).toHaveLength(1)
    expect(st.view.media.find((m) => m.id === st.view.video[1].mediaId)).toMatchObject({ kind: 'image', folder: 'Freeze frames' })
    await ed.close()
  }, 60000)

  it('a pasted image is saved in the project and attached as a photo', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    const png = new Uint8Array(readFileSync(f('photos/square.png')))
    const [a] = await ed.attachPastedImage(png)
    const [b] = await ed.attachPastedImage(png)
    expect(a.attached).toBe('photo')
    const media = ed.state()!.real.media
    expect(media.map((m) => [m.name, m.folder])).toEqual([['paste-1.png', 'Chat'], ['paste-2.png', 'Chat']])
    expect(b.mediaId).toBe(media[1].id)
    await ed.close()
  }, 60000)

  it('keeps a story in story.md; attaching a .md file in chat sets it', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    expect(await ed.getStory()).toBe('')
    await ed.setStory('# Trip\nopen on the river')
    expect(readFileSync(join(base, 'P.pedit', 'story.md'), 'utf8')).toBe('# Trip\nopen on the river')
    const chips = await ed.attachFiles([f('../story/story.md')])
    expect(chips).toEqual([{ name: 'story.md', mediaId: '', attached: 'story' }])
    expect(await ed.getStory()).toContain('temple bells')
    expect(ed.state()!.real.media).toHaveLength(0)
    await ed.close()
  }, 60000)

  it('keeps any other attached file in chat-files and returns its path; the same file twice is one copy', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pedit-ed-'))
    const ed = new Editor(quiet)
    await ed.newProject(join(base, 'P.pedit'), 'P')
    const src = join(base, 'look.cube'), other = join(base, 'x', 'look.cube'), notes = join(base, 'notes.pdf')
    mkdirSync(join(base, 'x'))
    writeFileSync(src, 'LUT_3D_SIZE 2\n')
    writeFileSync(other, 'LUT_3D_SIZE 3\n')
    writeFileSync(notes, '%PDF-1.7')
    const chips = await ed.attachFiles([src, notes, src, other, join(base, 'x')])
    const dir = join(base, 'P.pedit', 'chat-files')
    expect(chips).toEqual([
      { name: 'look.cube', mediaId: '', attached: 'file', path: join(dir, 'look.cube') },
      { name: 'notes.pdf', mediaId: '', attached: 'file', path: join(dir, 'notes.pdf') },
      { name: 'look.cube', mediaId: '', attached: 'file', path: join(dir, 'look-2.cube') }
    ])
    expect(readFileSync(join(dir, 'look-2.cube'), 'utf8')).toBe('LUT_3D_SIZE 3\n')
    expect((await ed.attachFiles([src]))[0].path).toBe(join(dir, 'look.cube'))
    expect(ed.state()!.real.media).toHaveLength(0)
    await ed.close()
  }, 60000)
})
