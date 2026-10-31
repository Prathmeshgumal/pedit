import type { PeditApi } from '../shared/ipc'
declare global {
  interface Window { pedit: PeditApi }
}
export {}
