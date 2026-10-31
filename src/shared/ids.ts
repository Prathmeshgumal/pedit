export type IdGen = (prefix: 'm' | 'c' | 't' | 'a') => string

export const randomIds: IdGen = (prefix) => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(3))
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function seqIds(): IdGen {
  let n = 0
  return (prefix) => `${prefix}_${String(++n).padStart(6, '0')}`
}
