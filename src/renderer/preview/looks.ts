import { buildLut, isNeutral, lookKey, parseCube, vignetteOf, LUT_SIZE, type ClipLook, type Cube } from '@shared/look'
import { mediaUrl } from '@shared/mediaUrl'
import type { Layer } from './compositor'

const luts = new Map<string, NonNullable<Layer['lut']> | 'pending' | 'failed'>()
const cubes = new Map<string, Promise<Cube>>()
const MAX = 24

function cube(path: string): Promise<Cube> {
  let p = cubes.get(path)
  if (!p) { p = fetch(mediaUrl(path)).then((r) => r.text()).then(parseCube); cubes.set(path, p) }
  return p
}

function bake(key: string, look: ClipLook, c: Record<string, Cube>): NonNullable<Layer['lut']> {
  const f = buildLut(look, c)
  const data = new Uint8Array(f.length)
  for (let i = 0; i < f.length; i++) data[i] = Math.round(f[i] * 255)
  const lut = { key, size: LUT_SIZE, data }
  luts.set(key, lut)
  while (luts.size > MAX) luts.delete(luts.keys().next().value!)
  return lut
}

/**
 * Byte LUT for a look; null if it changes nothing. Looks made only of adjustments are baked right away (a few ms);
 * ones that need a .cube file load in the background, return undefined meanwhile, and call onReady later (never during this call).
 */
export function lutFor(look: ClipLook | undefined, onReady: () => void): NonNullable<Layer['lut']> | null | undefined {
  if (isNeutral(look)) return null
  const key = lookKey(look)
  const hit = luts.get(key)
  if (hit === 'failed') return null
  if (hit && hit !== 'pending') { luts.delete(key); luts.set(key, hit); return hit }
  const file = look!.filter?.lut
  if (!file) return bake(key, look!, {})
  if (!hit) {
    luts.set(key, 'pending')
    cube(file).then((c) => { bake(key, look!, { [file]: c }); onReady() }, () => { luts.set(key, 'failed'); onReady() })
  }
  return undefined
}

export { vignetteOf }
