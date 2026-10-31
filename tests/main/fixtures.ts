import { resolve } from 'node:path'
export const FIX = resolve(import.meta.dirname, '../fixtures/media')
export const f = (rel: string): string => resolve(FIX, rel)
