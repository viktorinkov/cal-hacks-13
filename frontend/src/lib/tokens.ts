/**
 * Nocturne palette, shared by the PixiJS renderer (numbers) and the DOM (CSS variables in index.css).
 * Keep the two in sync; tokens.test.ts checks that every CSS variable below matches.
 */
export const color = {
  ground: '#0a0a0b',
  panel: '#0e0e10',
  raised: '#151518',
  ink: '#ecebe6',
  inkDim: '#a3a3a8',
  inkMuted: '#85858b',
  silver: '#cfd0d4',
  champagne: '#dcc79f',
  champagneHover: '#e9d8b6',
  red: '#ff3b30',
  aside: '#ffb547',
  caution: '#f0b44c',
  teal: '#6fb7ad',
  amber: '#d6a25a',
  green: '#8cc09b',
  grey: '#55555a',
  sectionFront: '#b8a6ff',
  sectionFloor: '#93c2ff',
  sectionWing: '#8fe0bf',
  sectionConcourse: '#ffbf94',
  sectionPlaza: '#f2dc8c',
  sectionFood: '#ff9fbf',
  sectionPassage: '#cfd0d4',
} as const

export type ColorToken = keyof typeof color

/** CSS custom property name for each token, as declared in index.css. */
export const cssVar: Record<ColorToken, string> = {
  ground: '--nc-ground',
  panel: '--nc-panel',
  raised: '--nc-raised',
  ink: '--nc-ink',
  inkDim: '--nc-ink-dim',
  inkMuted: '--nc-ink-muted',
  silver: '--nc-silver',
  champagne: '--nc-champagne',
  champagneHover: '--nc-champagne-hover',
  red: '--nc-red',
  aside: '--nc-aside',
  caution: '--nc-caution',
  teal: '--nc-teal',
  amber: '--nc-amber',
  green: '--nc-green',
  grey: '--nc-grey',
  sectionFront: '--nc-section-front',
  sectionFloor: '--nc-section-floor',
  sectionWing: '--nc-section-wing',
  sectionConcourse: '--nc-section-concourse',
  sectionPlaza: '--nc-section-plaza',
  sectionFood: '--nc-section-food',
  sectionPassage: '--nc-section-passage',
}

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

/** Numeric colours for PixiJS. */
export const px = Object.fromEntries(
  Object.entries(color).map(([k, v]) => [k, hexToNumber(v)]),
) as Record<ColorToken, number>
