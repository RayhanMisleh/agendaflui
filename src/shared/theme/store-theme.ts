import { contrastRatio } from './color'
import { AGENDAFLUI_BRAND } from './default-brand'
import { deriveTheme, type ThemeTokens, type ThemeVar } from './derive'

const MIN = 4.5

/** Os pares texto/fundo que a área do cliente usa com a cor da loja: cada um precisa de 4,5 de contraste. */
const PARES: readonly (readonly [ThemeVar, ThemeVar])[] = [
  ['--on-brand', '--brand'],
  ['--brand-text', '--ground'],
  ['--brand-text', '--surface'],
  ['--ink', '--brand-tint'],
]

/**
 * Tema da loja com contraste garantido. O motor (`deriveTheme`) já escurece a cor da loja quando o texto não fica legível;
 * esta é a segunda conferência, na hora de usar: se algum dos quatro pares ficar abaixo de 4,5, a área do cliente inteira
 * volta ao tema Agenda Flui (e `fellBack` avisa), nunca um tema pela metade.
 */
export function storeTheme(theme: ThemeTokens): { theme: ThemeTokens; fellBack: boolean } {
  const ok = PARES.every(([texto, fundo]) => contrastRatio(theme.vars[texto], theme.vars[fundo]) >= MIN)
  return ok ? { theme, fellBack: false } : { theme: deriveTheme(AGENDAFLUI_BRAND), fellBack: true }
}
