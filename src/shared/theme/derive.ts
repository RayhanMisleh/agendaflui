import { contrastRatio, hexToOklch, mix, normalizeHex, oklchToHex, shiftLightness } from './color'

// Mesmos valores dos enums do Prisma; declarados aqui porque src/shared não importa de src/server (nem de src/ui).
export type CoverMaterial = 'LEATHER' | 'LINEN' | 'WOOD' | 'ENAMEL'
export type PaperTone = 'WHITE' | 'CREAM' | 'GRAY'
export type FontPair = 'CLASSIC' | 'MODERN' | 'FRIENDLY'

/** Opções curadas (listas fechadas): o formulário e a validação do servidor usam estas mesmas. */
export const COVER_MATERIALS = ['LEATHER', 'LINEN', 'WOOD', 'ENAMEL'] as const satisfies readonly CoverMaterial[]
export const PAPER_TONES = ['WHITE', 'CREAM', 'GRAY'] as const satisfies readonly PaperTone[]
export const FONT_PAIRS = ['CLASSIC', 'MODERN', 'FRIENDLY'] as const satisfies readonly FontPair[]

/**
 * Sinais objetivos do motor, na ordem em que saem:
 * - `text_adjusted`: a cor principal foi trocada (escurecida) para o texto sobre a capa chegar a 4,5 de contraste;
 * - `accent_adjusted`: o mesmo com a cor de destaque;
 * - `relief_collapsed`: a capa perdeu o relevo (ver `RELIEF_MIN_DELTA_L`).
 */
export type ThemeWarning = 'text_adjusted' | 'accent_adjusted' | 'relief_collapsed'

/**
 * Diferença mínima de luminosidade (L do OKLCH, de 0 a 100) entre a capa e o seu realce (`--cover-hi`) e entre a capa e a
 * sua sombra (`--cover-lo`). O motor pede 8 pontos; abaixo da metade o relevo some (branco e amarelo neon não têm para
 * onde clarear, preto não tem para onde escurecer, e a capa fica chapada).
 */
export const RELIEF_MIN_DELTA_L = 4

export const THEME_WARNING_TEXT: Record<ThemeWarning, string> = {
  text_adjusted: 'A cor principal foi escurecida para o texto ficar legível.',
  accent_adjusted: 'A cor de destaque foi escurecida para o texto ficar legível.',
  relief_collapsed: 'Com esta cor principal o relevo da capa quase some. Escolha uma cor menos clara ou menos escura para a capa ter volume.',
}

export type BrandInput = {
  primary: string
  accent: string
  material: CoverMaterial
  paper: PaperTone
  fontPair: FontPair
}

export type ThemeTokens = {
  vars: Record<
    | '--cover' | '--cover-hi' | '--cover-lo' | '--cover-deep' | '--on-cover' | '--on-cover-soft'
    | '--accent' | '--accent-hi' | '--accent-lo' | '--on-accent' | '--accent-ink'
    | '--paper' | '--paper-edge' | '--paper-line' | '--paper-sunk' | '--ink' | '--ink-soft' | '--ink-faint'
    | '--ok' | '--warn' | '--bad',
    string
  >
  material: 'leather' | 'linen' | 'wood' | 'enamel'
  fontPair: 'classic' | 'modern' | 'friendly'
  warnings: string[]
  /** Os mesmos avisos como códigos estáveis (para a prévia e para testes). */
  signals: ThemeWarning[]
}

export const PAPER: Record<PaperTone, string> = {
  WHITE: '#FBFAF7',
  CREAM: '#F6EFDD',
  GRAY: '#ECEEF0',
}

const WHITE = '#FFFFFF'
const INK = '#1B1A17'
const MIN_TEXT = 4.5
// Folga do texto secundário sobre a capa: 5,5 quando a capa deixa; nunca abaixo de 4,5 (o `--on-cover` já tem).
const SOFT_ON_COVER = 5.5
const STEP = 2

/** Texto (branco ou tinta) sobre `bg`, o que der mais contraste. */
function bestOn(bg: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK
}

/** Escurece `base` de 2 em 2 pontos de L até `ok(cor)` valer. */
function darkenUntil(base: string, ok: (c: string) => boolean): { color: string; changed: boolean } {
  const { l, c, h } = hexToOklch(base)
  let color = base
  let step = 0
  while (!ok(color) && l - step * STEP > 0) {
    step += 1
    color = oklchToHex({ l: l - step * STEP, c, h })
  }
  return { color, changed: step > 0 }
}

/** Cor da marca usada como fundo de texto: garante 4.5 para o melhor texto. */
function fitSurface(base: string): { color: string; on: string; changed: boolean } {
  if (contrastRatio(bestOn(base), base) >= MIN_TEXT) return { color: base, on: bestOn(base), changed: false }
  const { color, changed } = darkenUntil(base, (c) => contrastRatio(WHITE, c) >= MIN_TEXT)
  return { color, on: WHITE, changed }
}

/** Maior passo de `fg` rumo a `toward` que ainda tem `min` contra todos os fundos. */
function softenTo(fg: string, toward: string, backgrounds: string[], min: number): string {
  let best = fg
  for (let t = 0.01; t <= 1.0001; t += 0.01) {
    const c = mix(fg, toward, t)
    if (backgrounds.every((bg) => contrastRatio(c, bg) >= min)) best = c
    else break
  }
  return best
}

const MATERIALS = { LEATHER: 'leather', LINEN: 'linen', WOOD: 'wood', ENAMEL: 'enamel' } as const
const FONTS = { CLASSIC: 'classic', MODERN: 'modern', FRIENDLY: 'friendly' } as const

export function deriveTheme(input: BrandInput): ThemeTokens {
  const signals: ThemeWarning[] = []
  const paper = PAPER[input.paper]

  const cover = fitSurface(normalizeHex(input.primary))
  if (cover.changed) signals.push('text_adjusted')
  const accent = fitSurface(normalizeHex(input.accent))
  if (accent.changed) signals.push('accent_adjusted')

  const accentInk = darkenUntil(accent.color, (c) => contrastRatio(c, paper) >= MIN_TEXT).color

  const edge = shiftLightness(paper, -12)
  const line = shiftLightness(paper, -7)
  const sunk = shiftLightness(paper, -4)

  const coverHi = shiftLightness(cover.color, 8)
  const coverLo = shiftLightness(cover.color, -8)
  const coverL = hexToOklch(cover.color).l
  const relief = Math.min(hexToOklch(coverHi).l - coverL, coverL - hexToOklch(coverLo).l)
  if (relief < RELIEF_MIN_DELTA_L) signals.push('relief_collapsed')

  const vars: ThemeTokens['vars'] = {
    '--cover': cover.color,
    '--cover-hi': coverHi,
    '--cover-lo': coverLo,
    '--cover-deep': shiftLightness(cover.color, -18),
    '--on-cover': cover.on,
    '--on-cover-soft': softenTo(cover.on, cover.color, [cover.color], SOFT_ON_COVER),
    '--accent': accent.color,
    '--accent-hi': shiftLightness(accent.color, 8),
    '--accent-lo': shiftLightness(accent.color, -8),
    '--on-accent': accent.on,
    '--accent-ink': accentInk,
    '--paper': paper,
    '--paper-edge': edge,
    '--paper-line': line,
    '--paper-sunk': sunk,
    '--ink': INK,
    '--ink-soft': softenTo(INK, paper, [paper, sunk], MIN_TEXT),
    '--ink-faint': softenTo(INK, paper, [paper], 3),
    '--ok': '#1E6B3A',
    '--warn': '#8A5A00',
    '--bad': '#B3261E',
  }

  return {
    vars,
    material: MATERIALS[input.material],
    fontPair: FONTS[input.fontPair],
    warnings: signals.map((s) => THEME_WARNING_TEXT[s]),
    signals,
  }
}
