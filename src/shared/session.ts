import type { ItemId, Project } from './model'
import { applyCommand, type Command, type CommandResult } from './commands'
import { randomIds, type IdGen } from './ids'

export type Source = 'user' | 'claude'
export interface DraftDiff { added: ItemId[]; removed: ItemId[]; changed: ItemId[] }
export interface SessionState {
  view: Project; real: Project; draftActive: boolean; diff: DraftDiff | null
  canUndo: boolean; canRedo: boolean; viewRevision: number
}

export class RevisionMismatch extends Error {
  constructor(public expected: number, public actual: number) {
    super(`timeline changed (rev ${actual}, you sent ${expected})`)
    this.name = 'RevisionMismatch'
  }
}

/**
 * Timeline snapshot. Undo never reverts imports or preview-building progress, so media is not snapshotted;
 * only which media ids existed, so media removed by a command (kept in the session's graveyard) can come back.
 */
type Snap = Pick<Project, 'settings' | 'video' | 'text' | 'audio'> & { mediaIds: string[] }
const snap = (p: Project): Snap => ({ ...structuredClone({ settings: p.settings, video: p.video, text: p.text, audio: p.audio }), mediaIds: p.media.map((m) => m.id) })
const isMediaCmd = (c: Command): boolean => c.type === 'addMedia' || c.type === 'updateMedia'

function diff(real: Project, draft: Project): DraftDiff {
  const index = (p: Project): Map<ItemId, string> =>
    new Map([...p.video, ...p.text, ...p.audio].map((i) => [i.id, JSON.stringify(i)] as const))
  const r = index(real)
  const d = index(draft)
  const added: ItemId[] = []
  const changed: ItemId[] = []
  for (const [id, json] of d) {
    if (!r.has(id)) added.push(id)
    else if (r.get(id) !== json) changed.push(id)
  }
  const removed = [...r.keys()].filter((id) => !d.has(id))
  return { added, removed, changed }
}

export class EditSession {
  private real: Project
  private draft: Project | null = null
  private draftRev = 0
  /** Last revision handed out; real and draft share it so a number never names two different timelines. */
  private rev: number
  private undoStack: Snap[] = []
  private redoStack: Snap[] = []
  private draftUndo: Snap[] = []
  private draftRedo: Snap[] = []
  private userEdits: string[] = []
  private listeners = new Set<(s: SessionState) => void>()
  /** Media removed by commands, so undo can bring it back. */
  private graveyard = new Map<string, Project['media'][number]>()

  private restore(p: Project, s: Snap): Project {
    const { mediaIds, ...timeline } = structuredClone(s)
    const want = new Set(mediaIds)
    const media = p.media.filter((m) => want.has(m.id) || !this.graveyard.has(m.id))
    for (const id of mediaIds) if (!media.some((m) => m.id === id) && this.graveyard.has(id)) media.push(structuredClone(this.graveyard.get(id)!))
    return { ...p, ...timeline, media }
  }

  private bury(before: Project, after: Project): void {
    const kept = new Set(after.media.map((m) => m.id))
    for (const m of before.media) if (!kept.has(m.id)) this.graveyard.set(m.id, structuredClone(m))
  }

  constructor(project: Project, private ids: IdGen = randomIds) {
    this.real = structuredClone(project)
    this.rev = project.revision
  }

  private bump(): number { return ++this.rev }

  state(): SessionState {
    const draftActive = this.draft !== null
    return {
      view: this.draft ?? this.real,
      real: this.real,
      draftActive,
      diff: this.draft ? diff(this.real, this.draft) : null,
      canUndo: draftActive ? this.draftUndo.length > 0 : this.undoStack.length > 0,
      canRedo: draftActive ? this.draftRedo.length > 0 : this.redoStack.length > 0,
      viewRevision: draftActive ? this.draftRev : this.real.revision
    }
  }

  apply(cmd: Command, source: Source, expectedRevision?: number): CommandResult {
    if (isMediaCmd(cmd)) {
      const r = applyCommand(this.real, cmd, this.ids)
      this.real = { ...r.project, revision: this.real.revision }
      if (this.draft) {
        // keep the draft's library in step with imports and progress, minus what the draft removed
        const inDraft = new Set(this.draft.media.map((m) => m.id))
        this.draft = { ...this.draft, media: structuredClone(this.real.media.filter((m) => inDraft.has(m.id) || !this.graveyard.has(m.id))) }
      }
      this.emit()
      return { ...r, project: this.state().view }
    }
    const current = this.state().viewRevision
    if (expectedRevision !== undefined && expectedRevision !== current) throw new RevisionMismatch(expectedRevision, current)
    if (this.draft) {
      const r = applyCommand(this.draft, cmd, this.ids)
      this.bury(this.draft, r.project)
      this.draftUndo.push(snap(this.draft))
      this.draftRedo = []
      this.draft = r.project
      this.draftRev = this.bump()
      if (source === 'user') this.userEdits.push(r.summary)
      this.emit()
      return r
    }
    const r = applyCommand(this.real, cmd, this.ids)
    this.bury(this.real, r.project)
    this.undoStack.push(snap(this.real))
    this.redoStack = []
    this.real = { ...r.project, revision: this.bump() }
    this.emit()
    return { ...r, project: this.real }
  }

  /** Claude's edits: open a draft on the first one (only if it succeeds), then apply into it. */
  applyToDraft(cmd: Command, source: Source, expectedRevision?: number): CommandResult {
    if (this.draft || isMediaCmd(cmd)) return this.apply(cmd, source, expectedRevision)
    const current = this.real.revision
    if (expectedRevision !== undefined && expectedRevision !== current) throw new RevisionMismatch(expectedRevision, current)
    const r = applyCommand(this.real, cmd, this.ids) // throws before any draft exists
    this.bury(this.real, r.project)
    this.draft = structuredClone(this.real)
    this.draftUndo = [snap(this.draft)]
    this.draftRedo = []
    this.draft = r.project
    this.draftRev = this.bump()
    this.emit()
    return r
  }

  undo(): void { this.step(true) }
  redo(): void { this.step(false) }

  private step(undo: boolean): void {
    if (this.draft) {
      const [from, to] = undo ? [this.draftUndo, this.draftRedo] : [this.draftRedo, this.draftUndo]
      const s = from.pop()
      if (!s) return
      to.push(snap(this.draft))
      this.draft = this.restore(this.draft, s)
      this.draftRev = this.bump()
    } else {
      const [from, to] = undo ? [this.undoStack, this.redoStack] : [this.redoStack, this.undoStack]
      const s = from.pop()
      if (!s) return
      to.push(snap(this.real))
      this.real = { ...this.restore(this.real, s), revision: this.bump() }
    }
    this.emit()
  }

  startDraft(): void {
    if (this.draft) return
    this.draft = structuredClone(this.real)
    this.draftRev = this.real.revision
    this.draftUndo = []
    this.draftRedo = []
    this.userEdits = []
    this.emit()
  }

  acceptDraft(): void {
    if (!this.draft) return
    this.undoStack.push(snap(this.real))
    this.redoStack = []
    this.real = { ...this.restore(this.real, snap(this.draft)), revision: this.bump() }
    this.draft = null
    this.emit()
  }

  rejectDraft(): void {
    if (!this.draft) return
    this.draft = null
    this.emit()
  }

  /** Project name lives outside undo history. */
  renameProject(name: string): void {
    this.real = { ...this.real, name }
    if (this.draft) this.draft = { ...this.draft, name }
    this.emit()
  }

  takeUserEditsSinceLastTurn(): string[] {
    const e = this.userEdits
    this.userEdits = []
    return e
  }

  onChange(cb: (s: SessionState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    if (!this.listeners.size) return
    const s = this.state()
    for (const l of this.listeners) l(s)
  }
}
