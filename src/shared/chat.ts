import { READ_TOOLS } from './ipc'

export const ERROR_TEXT: Record<string, string> = {
  not_installed: 'Install Claude Code, then restart pedit.',
  not_logged_in: 'Open a terminal and run `claude` once to log in.',
  usage_limit: 'Claude usage limit reached — try again later.',
  stopped: 'Stopped. The draft keeps what was done so far.'
}

export const errorText = (error?: string, message?: string): string => ERROR_TEXT[error ?? ''] ?? message ?? 'Claude stopped unexpectedly.'

/** Text for one finished tool step, as shown and stored in chat history. */
export function stepText(name: string, ok: boolean, result: string): string {
  if (READ_TOOLS[name]) return `· ${READ_TOOLS[name]}`
  return `${ok ? '✓' : '✗'} ${result.replace(/ · rev \d+$/, '')}`
}
