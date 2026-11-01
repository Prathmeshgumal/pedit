import { timelineDurationMs, type Project } from './model'
import { fmtTime } from './time'
import { transformText } from './commands'
import { transitionMs } from './transitions'
import { audioCutAt } from './clipAudio'
export { fmtTime } from './time'

const pct = (v: number): string => `${Math.round(v * 100)}%`

export function timelineSummary(p: Project, opts: { draft: boolean; revision: number }): string {
  const name = (id: string): string => p.media.find((m) => m.id === id)?.name ?? id
  const s = p.settings
  const head = `rev ${opts.revision}${opts.draft ? ' · DRAFT' : ''} · ${s.aspect} ${s.width}x${s.height} ${s.fps}fps · length ${fmtTime(timelineDurationMs(p))}`
  const block = (title: string, lines: string[]): string => `${title}\n${lines.length ? lines.join('\n') : '  (empty)'}`
  const video = p.video.map((v, i) => {
    const tf = transformText(v.transform)
    const lk = v.look ? [v.look.filter ? `filter ${v.look.filter.name}${v.look.filter.strength < 1 ? ` ${Math.round(v.look.filter.strength * 100)}%` : ''}` : '', v.look.adjust ? `adjust ${JSON.stringify(v.look.adjust)}` : ''].filter(Boolean).join(' ') : ''
    const tr = v.transition ? ` ← ${v.transition.type} ${transitionMs(p.video, i) / 1000}s` : ''
    const jlReal = v.audioCutMs ? audioCutAt(p, i) : 0
    const jl = v.audioCutMs ? ` ${v.audioCutMs < 0 ? 'J' : 'L'}-cut ${Math.abs(v.audioCutMs) / 1000}s${jlReal !== v.audioCutMs ? ` (only ${Math.abs(jlReal) / 1000}s possible: clip lengths or footage before/after)` : ''}` : ''
    return `  ${v.id} ${fmtTime(v.startMs)}-${fmtTime(v.startMs + v.outMs - v.inMs)} ${name(v.mediaId)} [src ${fmtTime(v.inMs)}-${fmtTime(v.outMs)}]${v.volume !== 1 ? ` vol ${pct(v.volume)}` : ''}${tf ? ` ${tf}` : ''}${lk ? ` ${lk}` : ''}${tr}${jl}`
  })
  const where = (st: Project['text'][number]['style']): string => {
    const rot = st.rotation ? ` rot ${Math.round(st.rotation)}` : ''
    return st.position === 'custom' ? `x ${(st.x ?? 0.5).toFixed(2)} y ${(st.y ?? 0.5).toFixed(2)}${rot}` : `${st.position}${rot}`
  }
  const text = p.text.map((t) => `  ${t.id} ${fmtTime(t.startMs)}-${fmtTime(t.startMs + t.durationMs)} ${JSON.stringify(t.text)} (${where(t.style)})`)
  const lanes = p.audio.some((a) => (a.lane ?? 0) > 0) || p.audio.some((a) => p.video.some((v) => v.mediaId === a.mediaId))
  const music = [...p.audio].sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0) || a.startMs - b.startMs)
    .map((a) => `  ${a.id} ${fmtTime(a.startMs)}-${fmtTime(a.startMs + a.outMs - a.inMs)} ${name(a.mediaId)} vol ${pct(a.volume)}${lanes ? ` lane ${a.lane ?? 0}` : ''}`)
  return [head, block('VIDEO', video), block('TEXT', text), block('AUDIO', music)].join('\n')
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
