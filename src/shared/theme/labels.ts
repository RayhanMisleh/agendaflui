import type { CoverMaterial, FontPair, PaperTone } from './derive'

/**
 * Rótulos da personalização da conta, num só lugar. Os valores gravados no banco (`CoverMaterial`, `PaperTone`,
 * `FontPair`) não mudaram: aqui está o que cada um significa na tela.
 */
export type Option<V extends string> = { value: V; label: string; hint: string }

/** `material` (enum `CoverMaterial`): a barra lateral do painel. */
export const SIDEBAR_FIELD_LABEL = 'Barra lateral'
export const SIDEBAR_OPTIONS: readonly Option<CoverMaterial>[] = [
  { value: 'LEATHER', label: 'Cheia', hint: 'Na cor da conta, com a logo em negativo.' },
  { value: 'LINEN', label: 'Suave', hint: 'Num tom bem claro da cor da conta.' },
  { value: 'WOOD', label: 'Noite', hint: 'Escura, com o item ativo na cor da conta.' },
  { value: 'ENAMEL', label: 'Clara', hint: 'Branca, com o item ativo em tom suave.' },
]

/** `paper` (enum `PaperTone`): o fundo das telas. */
export const GROUND_FIELD_LABEL = 'Fundo'
export const GROUND_OPTIONS: readonly Option<PaperTone>[] = [
  { value: 'WHITE', label: 'Branco', hint: 'Branco puro.' },
  { value: 'CREAM', label: 'Espuma', hint: 'Quase branco, com um sopro da cor da conta.' },
  { value: 'GRAY', label: 'Neutro', hint: 'Cinza bem claro, sem cor.' },
]

/** `fontPair` (enum `FontPair`): `CLASSIC` é o par da marca Agenda Flui. */
export const FONT_PAIR_FIELD_LABEL = 'Par de fontes'
export const FONT_PAIR_OPTIONS: readonly Option<FontPair>[] = [
  { value: 'CLASSIC', label: 'Agenda Flui', hint: 'Bricolage Grotesque nos títulos e Figtree no texto.' },
  { value: 'MODERN', label: 'Moderno', hint: 'Títulos sem serifa, de traço limpo.' },
  { value: 'FRIENDLY', label: 'Amigável', hint: 'Títulos de cantos redondos.' },
]

export const PRIMARY_FIELD_LABEL = 'Cor da conta'
export const ACCENT_FIELD_LABEL = 'Cor de destaque'

export const labelOf = <V extends string>(options: readonly Option<V>[], value: V): string =>
  options.find((o) => o.value === value)?.label ?? value
