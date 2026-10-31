import { timelineDurationMs, type Project } from './model'
import { fmtTime } from './time'
export { fmtTime } from './time'

const pct = (v: number): string => `${Math.round(v * 100)}%`

export function timelineSummary(p: Project, opts: { draft: boolean; revision: number }): string {
  const name = (id: string): string => p.media.find((m) => m.id === id)?.name ?? id
  const s = p.settings
  const head = `rev ${opts.revision}${opts.draft ? ' · DRAFT' : ''} · ${s.aspect} ${s.width}x${s.height} ${s.fps}fps · length ${fmtTime(timelineDurationMs(p))}`
  const block = (title: string, lines: string[]): string => `${title}\n${lines.length ? lines.join('\n') : '  (empty)'}`
  const video = p.video.map((v) => `  ${v.id} ${fmtTime(v.startMs)}-${fmtTime(v.startMs + v.outMs - v.inMs)} ${name(v.mediaId)} [src ${fmtTime(v.inMs)}-${fmtTime(v.outMs)}]${v.volume !== 1 ? ` vol ${pct(v.volume)}` : ''}`)
  const text = p.text.map((t) => `  ${t.id} ${fmtTime(t.startMs)}-${fmtTime(t.startMs + t.durationMs)} ${JSON.stringify(t.text)} (${t.style.position})`)
  const music = p.audio.map((a) => `  ${a.id} ${fmtTime(a.startMs)}-${fmtTime(a.startMs + a.outMs - a.inMs)} ${name(a.mediaId)} vol ${pct(a.volume)}`)
  return [head, block('VIDEO', video), block('TEXT', text), block('MUSIC', music)].join('\n')
}

export function mediaSummary(p: Project): string {
  const list = [...p.media].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.importIndex - b.importIndex)
  if (!list.length) return '(no media imported)'
  return list.map((m) => {
    const when = `${m.createdAt.slice(0, 10)} ${m.createdAt.slice(11, 16)}`
    const parts = [`${m.id} ${m.name}`, `folder ${m.folder || '-'}`, when, m.kind === 'image' ? 'photo' : fmtTime(m.durationMs)]
    if (m.kind === 'audio') parts.push('audio only')
    else if (m.kind === 'image') parts.push(`${m.width}x${m.height}`)
    else parts.push(`${m.width}x${m.height} ${Math.round(m.fps)}fps`, m.hasAudio ? 'audio' : 'no audio')
    if (m.status === 'offline') parts.push('OFFLINE')
    return parts.join(' · ')
  }).join('\n')
}
