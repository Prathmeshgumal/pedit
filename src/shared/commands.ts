import type { ItemId, MediaId, MediaItem, Project } from './model'
import type { IdGen } from './ids'

export type Command =
  | { type: 'addMedia'; items: MediaItem[] }
  | { type: 'updateMedia'; id: MediaId; patch: Partial<MediaItem> }

export type CommandErrorCode = 'not_found' | 'overlap' | 'invalid' | 'media_not_found'

export class CommandError extends Error {
  constructor(public code: CommandErrorCode, message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

export interface CommandResult { project: Project; summary: string; affected: ItemId[] }

/** Pure: returns a new project, never mutates `p`, never changes `revision`. */
export function applyCommand(p: Project, cmd: Command, _ids: IdGen): CommandResult {
  const next = structuredClone(p)
  switch (cmd.type) {
    case 'addMedia': {
      next.media.push(...structuredClone(cmd.items))
      return { project: next, summary: `added ${cmd.items.length} media`, affected: cmd.items.map((m) => m.id) }
    }
    case 'updateMedia': {
      const i = next.media.findIndex((m) => m.id === cmd.id)
      if (i < 0) throw new CommandError('not_found', `media ${cmd.id} not found`)
      next.media[i] = { ...next.media[i], ...structuredClone(cmd.patch), id: cmd.id }
      return { project: next, summary: `updated ${cmd.id}`, affected: [cmd.id] }
    }
  }
}
