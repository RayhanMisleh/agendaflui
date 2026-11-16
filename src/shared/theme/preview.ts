import { deriveTheme, type BrandInput, type ThemeTokens, type ThemeWarning } from './derive'

export { COVER_MATERIALS, FONT_PAIRS, PAPER_TONES, RELIEF_MIN_DELTA_L } from './derive'
export type { ThemeWarning } from './derive'

type ThemeInput = BrandInput

// Cor da marca AgendaFlui (a padrão de conta nova). Fica aqui porque `src/shared` não importa de `src/ui`.
const PADRAO: Pick<ThemeInput, 'primary' | 'accent'> = { primary: '#0E4F5C', accent: '#E0A030' }

const HEX = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Cor que ainda está sendo digitada (`#7a1`, `red`) não derruba a prévia: vale a cor padrão até estar completa. */
function corOuPadrao(valor: string, padrao: string): string {
  return HEX.test(valor.trim()) ? valor : padrao
}

/**
 * Prévia do tema de uma conta, sem servidor e sem tela: roda no navegador e no servidor. É a mesma `deriveTheme` que
 * o painel do negócio usa ao renderizar a marca, então `tokens` são exatamente as variáveis que ele aplica.
 * `theme` traz também material e fonte (para o `ThemeScope`) e `warnings` os sinais do motor, na ordem fixa.
 */
export function previewTheme(i: ThemeInput): { tokens: Record<string, string>; warnings: ThemeWarning[]; theme: ThemeTokens } {
  const theme = deriveTheme({
    ...i,
    primary: corOuPadrao(i.primary, PADRAO.primary),
    accent: corOuPadrao(i.accent, PADRAO.accent),
  })
  return { tokens: { ...theme.vars }, warnings: [...theme.signals], theme }
}
