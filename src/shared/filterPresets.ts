import type { Adjust } from './look'

/** A named look. `lut` is a .cube file (absolute path) applied before the adjustments. */
export interface FilterPreset { name: string; description: string; adjust: Adjust; lut?: string; source?: 'builtin' | 'user' }

export const BUILTIN_FILTERS: FilterPreset[] = [
  { name: 'Warm', description: 'Gentle warmth, a little richer colour', adjust: { temperature: 35, saturation: 8, vibrance: 10 } },
  { name: 'Cool', description: 'Crisp, slightly blue', adjust: { temperature: -35, tint: -5, contrast: 6 } },
  { name: 'Vivid', description: 'Punchy colours and contrast for bright daytime shots', adjust: { vibrance: 45, saturation: 12, contrast: 15, shadows: 10 } },
  { name: 'Cinematic', description: 'Teal shadows, warm highlights, soft contrast (the blockbuster look)', adjust: { contrast: 12, saturation: -8, shadowHue: 190, shadowTone: 55, highlightHue: 30, highlightTone: 45, highlights: -15, vignette: 25 } },
  { name: 'Golden hour', description: 'Sunset glow: warm, soft and bright', adjust: { temperature: 55, tint: 8, highlights: -10, shadows: 15, vibrance: 20, highlightHue: 35, highlightTone: 35 } },
  { name: 'Film', description: 'Matte blacks, muted greens, a hint of grain-era warmth', adjust: { fade: 30, contrast: -6, saturation: -15, temperature: 10, shadowHue: 160, shadowTone: 25, vignette: 15 } },
  { name: 'Vintage', description: 'Faded, warm and soft like an old print', adjust: { fade: 45, saturation: -30, temperature: 30, contrast: -12, highlightHue: 45, highlightTone: 30, vignette: 30 } },
  { name: 'Moody', description: 'Dark, desaturated and cool', adjust: { exposure: -15, contrast: 18, saturation: -25, temperature: -15, shadows: -15, shadowHue: 210, shadowTone: 35, vignette: 40 } },
  { name: 'Pastel', description: 'Light, airy and soft colours', adjust: { brightness: 15, contrast: -20, saturation: -15, fade: 20, highlights: -10 } },
  { name: 'Bright & clean', description: 'Lifts dull or underexposed footage', adjust: { exposure: 15, shadows: 25, highlights: -10, vibrance: 15 } },
  { name: 'Night city', description: 'Neon nights: cool shadows, magenta highlights', adjust: { temperature: -25, tint: 15, contrast: 15, vibrance: 30, shadowHue: 220, shadowTone: 40, highlightHue: 310, highlightTone: 30 } },
  { name: 'Black & white', description: 'Clean monochrome', adjust: { saturation: -100, contrast: 10 } },
  { name: 'Noir', description: 'High-contrast monochrome with dark edges', adjust: { saturation: -100, contrast: 45, shadows: -20, vignette: 45 } },
  { name: 'Sepia', description: 'Brown-toned monochrome', adjust: { saturation: -100, highlightHue: 35, highlightTone: 60, shadowHue: 25, shadowTone: 40, fade: 15 } },
  { name: 'Green & teal', description: 'Nature boost: lush greens, clear skies', adjust: { vibrance: 30, tint: -10, temperature: -8, contrast: 8 } }
]
