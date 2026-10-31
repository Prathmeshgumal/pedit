import type { Player } from './player'
let player: Player | null = null
export const setPlayer = (p: Player | null): void => { player = p }
export const getPlayer = (): Player | null => player
