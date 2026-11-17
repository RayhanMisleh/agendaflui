import { contrastRatio, hexToOklch, mix, normalizeHex, oklchToHex } from './color'

// Mesmos valores dos enums do Prisma; declarados aqui porque src/shared não importa de src/server (nem de src/ui).
// Os valores gravados no banco não mudam: só o sentido na tela (ver `labels.ts`).
export type CoverMaterial = 'LEATHER' | 'LINEN' | 'WOOD' | 'ENAMEL'
export type PaperTone = 'WHITE' | 'CREAM' | 'GRAY'
export type FontPair = 'CLASSIC' | 'MODERN' | 'FRIENDLY'
export type ThemeScheme = 'day' | 'night'

/** Opções curadas (listas fechadas): o formulário e a validação do servidor usam estas mesmas. */
export const COVER_MATERIALS = ['LEATHER', 'LINEN', 'WOOD', 'ENAMEL'] as const satisfies readonly CoverMaterial[]
export const PAPER_TONES = ['WHITE', 'CREAM', 'GRAY'] as const satisfies readonly PaperTone[]
export const FONT_PAIRS = ['CLASSIC', 'MODERN', 'FRIENDLY'] as const satisfies readonly FontPair[]

/**
 * Sinais objetivos do motor, na ordem em que saem:
 * - `text_adjusted`: a cor da conta não dava texto legível (sobre ela ou sobre os fundos claros) e o motor usou um tom
 *   mais escuro dela (nos botões e/ou nos links);
 * - `accent_adjusted`: a cor de destaque foi clareada para a tinta ter 4,5 de contraste sobre ela;
 * - `sidebar_near_ground`: a barra lateral quase some contra o fundo (ver `SIDEBAR_GROUND_MIN_CONTRAST`);
 * - `invalid_color`: só a prévia emite (cor fora do formato `#RRGGBB`; o servidor recusaria).
 */
export type ThemeWarning = 'invalid_color' | 'text_adjusted' | 'accent_adjusted' | 'sidebar_near_ground'

/**
 * Contraste mínimo entre a cor da barra lateral e a do fundo da página. Abaixo disso a barra se confunde com o conteúdo
 * (barra suave ou clara sobre fundo espuma): é só uma diferença visível entre as duas superfícies, não um requisito de
 * leitura (AA).
 */
export const SIDEBAR_GROUND_MIN_CONTRAST = 1.15

/** Os textos dos avisos moram só aqui; as telas importam este mapa. */
export const THEME_WARNING_TEXT: Record<ThemeWarning, string> = {
  invalid_color: 'Use cores no formato #RRGGBB, com 6 dígitos. Enquanto isso, a prévia usa a cor padrão.',
  text_adjusted: 'Com esta cor da conta o texto não fica legível. Botões e links usam um tom mais escuro dela; para manter a cor exata, escolha uma cor mais escura.',
  accent_adjusted: 'A cor de destaque foi clareada para o texto escuro ficar legível sobre ela.',
  sidebar_near_ground: 'A barra lateral tem quase a mesma cor do fundo e se perde na tela. Escolha a barra Cheia ou Noite, ou um fundo mais distante dela.',
}

export type BrandInput = {
  primary: string
  accent: string
  material: CoverMaterial
  paper: PaperTone
  fontPair: FontPair
  /** `day` (padrão) é o painel do negócio; `night` é o tema escuro da marca (painel dev). */
  scheme?: ThemeScheme
}

export const THEME_VARS = [
  '--brand', '--brand-strong', '--brand-tint', '--on-brand', '--brand-text',
  '--accent', '--accent-tint', '--on-accent',
  '--ground', '--surface', '--ink', '--ink-muted', '--line',
  '--success', '--success-tint', '--danger', '--danger-tint',
  '--side-bg', '--side-ink', '--side-ink-muted', '--side-line', '--side-active-bg', '--side-active-ink',
  '--font-display', '--font-sans',
] as const
export type ThemeVar = (typeof THEME_VARS)[number]

export type ThemeTokens = {
  vars: Record<ThemeVar, string>
  scheme: ThemeScheme
  material: 'leather' | 'linen' | 'wood' | 'enamel'
  fontPair: 'classic' | 'modern' | 'friendly'
  warnings: string[]
  /** Os mesmos avisos como códigos estáveis (para a prévia e para testes). */
  signals: ThemeWarning[]
}

const WHITE = '#FFFFFF'
const MIN_TEXT = 4.5
// Folga do texto secundário sobre a cor cheia: 5,5 quando a cor deixa; nunca abaixo de 4,5.
const SOFT_ON_FILL = 5.5

// Paleta fixa da marca (design-tokens/agenda-flui-tokens.json), no dia e na noite.
const INK = '#0F2A27'
const DAY = {
  inkMuted: '#4A615D',
  line: '#D3E2DE',
  success: '#1E8A4C',
  danger: '#C8412F',
  successTint: '#DDF1E5',
  dangerTint: '#F8E2DD',
} as const
const NIGHT = {
  ground: '#0C1A18',
  surface: '#13241F',
  ink: '#E8F2EF',
  inkMuted: '#9DB3AE',
  line: '#24403A',
  success: '#4CC47E',
  danger: '#F07A68',
  successTint: '#143A27',
  dangerTint: '#4A2019',
  /** Texto escuro sobre a água clara. */
  onBrand: '#062421',
} as const

const FONTS: Record<FontPair, { display: string; sans: string }> = {
  CLASSIC: {
    display: "var(--font-bricolage, 'Bricolage Grotesque'), var(--font-figtree, Figtree), system-ui, sans-serif",
    sans: 'var(--font-figtree, Figtree), system-ui, sans-serif',
  },
  MODERN: {
    display: "var(--font-display-modern, 'Schibsted Grotesk'), system-ui, sans-serif",
    sans: 'var(--font-figtree, Figtree), system-ui, sans-serif',
  },
  FRIENDLY: {
    display: "var(--font-display-friendly, Fredoka), 'Trebuchet MS', sans-serif",
    sans: 'var(--font-figtree, Figtree), system-ui, sans-serif',
  },
}

type Tone = { l?: number; dl?: number; c?: number; cMax?: number; dh?: number }

/** Nova cor na mesma família: luminosidade absoluta (`l`) ou deslocada (`dl`), croma como fração do original. */
function retone(base: string, t: Tone): string {
  const o = hexToOklch(base)
  const c = Math.min(o.c * (t.c ?? 1), t.cMax ?? Infinity)
  return oklchToHex({ l: t.l ?? o.l + (t.dl ?? 0), c, h: o.h + (t.dh ?? 0) })
}

/** Texto (branco ou `dark`) sobre `bg`, o que der mais contraste. */
function bestOn(bg: string, dark: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(dark, bg) ? WHITE : dark
}

/** Anda de 1 em 1 ponto de L (para escuro ou claro) até `ok(cor)` valer. */
function nudgeUntil(base: string, dir: 1 | -1, ok: (c: string) => boolean): { color: string; changed: boolean } {
  const { l, c, h } = hexToOklch(base)
  let color = base
  let step = 0
  while (!ok(color)) {
    const next = l + dir * (step + 1)
    if (next < 0 || next > 100) break
    step += 1
    color = oklchToHex({ l: next, c, h })
  }
  return { color, changed: step > 0 }
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

const allAtLeast = (c: string, backgrounds: string[]) => backgrounds.every((bg) => contrastRatio(c, bg) >= MIN_TEXT)

/** Um tom claro da cor para fundos escuros: o texto escuro da noite se lê sobre ele e ele se vê sobre `backgrounds`. */
function lightVariant(primary: string, backgrounds: string[]): string {
  return nudgeUntil(primary, 1, (c) => allAtLeast(c, backgrounds) && contrastRatio(NIGHT.onBrand, c) >= MIN_TEXT).color
}

// Bolha: a cor da conta bem clara (a marca: #D7EFEB sobre #0B6E66). Na noite, um tom fundo da mesma cor.
const tintOf = (brand: string, night: boolean) =>
  night ? retone(brand, { l: 33.9, c: 0.6, cMax: 0.06 }) : retone(brand, { l: 93.3, c: 0.31 })
// Mel: o destaque bem claro, com a matiz deslocada 6° (a marca: #FCEBD0 sobre #F2A93B).
const accentTintOf = (accent: string, night: boolean) =>
  night ? retone(accent, { l: 30, c: 0.3, cMax: 0.06 }) : retone(accent, { l: 94.7, c: 0.27, dh: 6 })

/** Espuma: quase-branco com um sopro da matiz da cor da conta (a marca: #F3F8F6). */
function foam(brand: string): string {
  const o = hexToOklch(brand)
  return oklchToHex({ l: 97.5, c: Math.min(o.c * 0.07, 0.012), h: o.h - 15 })
}

type Ground = { ground: string; surface: string; line: string }
function groundFor(paper: PaperTone, brand: string): Ground {
  if (paper === 'WHITE') return { ground: WHITE, surface: WHITE, line: mix(DAY.line, INK, 0.12) }
  if (paper === 'GRAY') return { ground: '#F4F5F5', surface: WHITE, line: '#D9DDDD' }
  return { ground: foam(brand), surface: WHITE, line: DAY.line }
}

const MATERIALS = { LEATHER: 'leather', LINEN: 'linen', WOOD: 'wood', ENAMEL: 'enamel' } as const
const FONT_NAMES = { CLASSIC: 'classic', MODERN: 'modern', FRIENDLY: 'friendly' } as const

type Palette = {
  brand: string
  brandStrong: string
  tint: string
  onBrand: string
  brandText: string
  ground: Ground
  ink: string
  inkMuted: string
  night: boolean
}

type Side = Pick<Record<ThemeVar, string>, '--side-bg' | '--side-ink' | '--side-ink-muted' | '--side-line' | '--side-active-bg' | '--side-active-ink'>

/** Barra lateral: Cheia (cor da conta), Suave (Bolha), Noite (tinta escura) ou Clara (superfície). */
function sidebar(material: CoverMaterial, p: Palette, primary: string): Side {
  const { surface } = p.ground
  if (material === 'LEATHER') {
    return {
      '--side-bg': p.brand,
      '--side-ink': p.onBrand,
      '--side-ink-muted': softenTo(p.onBrand, p.brand, [p.brand], SOFT_ON_FILL),
      '--side-line': mix(p.brand, p.onBrand, 0.22),
      '--side-active-bg': surface,
      '--side-active-ink': p.brandText,
    }
  }
  if (material === 'LINEN') {
    return {
      '--side-bg': p.tint,
      '--side-ink': p.ink,
      '--side-ink-muted': p.inkMuted,
      '--side-line': mix(p.tint, p.brand, 0.22),
      '--side-active-bg': p.brand,
      '--side-active-ink': p.onBrand,
    }
  }
  if (material === 'WOOD') {
    const bg = retone(primary, { l: p.night ? 14 : 26.15, c: 0.4 })
    const active = p.night ? p.brand : lightVariant(primary, [bg])
    return {
      '--side-bg': bg,
      '--side-ink': NIGHT.ink,
      '--side-ink-muted': NIGHT.inkMuted,
      '--side-line': mix(bg, NIGHT.ink, 0.14),
      '--side-active-bg': active,
      '--side-active-ink': bestOn(active, NIGHT.onBrand),
    }
  }
  return {
    '--side-bg': surface,
    '--side-ink': p.ink,
    '--side-ink-muted': p.inkMuted,
    '--side-line': p.ground.line,
    '--side-active-bg': p.tint,
    '--side-active-ink': p.brandText,
  }
}

export function deriveTheme(input: BrandInput): ThemeTokens {
  const scheme = input.scheme ?? 'day'
  const night = scheme === 'night'
  const signals: ThemeWarning[] = []
  const primary = normalizeHex(input.primary)
  const accentIn = normalizeHex(input.accent)

  let brand: string
  let onBrand: string
  let ground: Ground
  let ink: string
  let inkMuted: string
  let textAdjusted = false

  if (night) {
    ground = { ground: NIGHT.ground, surface: NIGHT.surface, line: NIGHT.line }
    ink = NIGHT.ink
    inkMuted = NIGHT.inkMuted
    brand = lightVariant(primary, [ground.ground, ground.surface, tintOf(primary, true)])
    onBrand = bestOn(brand, NIGHT.onBrand)
  } else {
    ink = INK
    inkMuted = DAY.inkMuted
    const best = bestOn(primary, INK)
    if (contrastRatio(best, primary) >= MIN_TEXT) {
      brand = primary
      onBrand = best
    } else {
      brand = nudgeUntil(primary, -1, (c) => contrastRatio(WHITE, c) >= MIN_TEXT).color
      onBrand = WHITE
      textAdjusted = true
    }
    ground = groundFor(input.paper, brand)
  }

  const tint = tintOf(brand, night)
  const backgrounds = [ground.ground, ground.surface, tint]
  // Texto na cor da conta (links, item ativo): a própria cor se der 4,5; senão, um tom mais escuro (dia) ou claro (noite).
  const brandText = nudgeUntil(brand, night ? 1 : -1, (c) => allAtLeast(c, backgrounds))
  if (brandText.changed && !night) textAdjusted = true
  if (textAdjusted) signals.push('text_adjusted')

  // Hover e pressionado: mais escuro no dia, mais claro na noite; nunca a ponto de a cor do texto perder 4,5.
  let strong = brand
  for (let k = 1; k >= 0; k -= 0.1) {
    const cand = night ? retone(brand, { dl: 7.85 * k, c: 1 - 0.119 * k }) : retone(brand, { dl: -8.6 * k, c: 1 - 0.185 * k })
    if (contrastRatio(onBrand, cand) >= MIN_TEXT) {
      strong = cand
      break
    }
  }

  // O destaque nunca é cor de texto; o texto sobre ele é sempre a tinta. Se ela não der 4,5, o destaque clareia.
  const accent = nudgeUntil(accentIn, 1, (c) => contrastRatio(INK, c) >= MIN_TEXT)
  if (accent.changed) signals.push('accent_adjusted')

  const palette: Palette = { brand, brandStrong: strong, tint, onBrand, brandText: brandText.color, ground, ink, inkMuted, night }
  const side = sidebar(input.material, palette, primary)
  if (contrastRatio(side['--side-bg'], ground.ground) < SIDEBAR_GROUND_MIN_CONTRAST) signals.push('sidebar_near_ground')

  const font = FONTS[input.fontPair]
  const vars: ThemeTokens['vars'] = {
    '--brand': brand,
    '--brand-strong': strong,
    '--brand-tint': tint,
    '--on-brand': onBrand,
    '--brand-text': brandText.color,
    '--accent': accent.color,
    '--accent-tint': accentTintOf(accent.color, night),
    '--on-accent': INK,
    '--ground': ground.ground,
    '--surface': ground.surface,
    '--ink': ink,
    '--ink-muted': inkMuted,
    '--line': ground.line,
    '--success': night ? NIGHT.success : DAY.success,
    '--success-tint': night ? NIGHT.successTint : DAY.successTint,
    '--danger': night ? NIGHT.danger : DAY.danger,
    '--danger-tint': night ? NIGHT.dangerTint : DAY.dangerTint,
    ...side,
    '--font-display': font.display,
    '--font-sans': font.sans,
  }

  return {
    vars,
    scheme,
    material: MATERIALS[input.material],
    fontPair: FONT_NAMES[input.fontPair],
    warnings: signals.map((s) => THEME_WARNING_TEXT[s]),
    signals,
  }
}
