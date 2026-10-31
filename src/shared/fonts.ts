export interface FontFaceFile { weight: number; path: string }
export interface FontInfo { family: string; category: string; source: 'builtin' | 'user'; faces: FontFaceFile[] }
/** Always loaded and used after the chosen font, so missing letters (e.g. Hindi) still show. */
export const FALLBACK_FONTS = ['Inter', 'Noto Sans Devanagari']
