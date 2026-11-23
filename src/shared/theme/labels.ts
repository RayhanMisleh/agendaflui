import type { CoverMaterial } from './derive'

/**
 * Rótulos da personalização da conta, num só lugar. Os valores gravados no banco (`CoverMaterial`) não mudaram: aqui
 * está o que cada um significa na tela.
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

export const PRIMARY_FIELD_LABEL = 'Cor da conta'
export const ACCENT_FIELD_LABEL = 'Cor de destaque'

export const labelOf = <V extends string>(options: readonly Option<V>[], value: V): string =>
  options.find((o) => o.value === value)?.label ?? value
