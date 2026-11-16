import { deriveTheme, type BrandInput, type ThemeTokens, type ThemeWarning } from './derive'

export { COVER_MATERIALS, COVER_PAPER_MIN_CONTRAST, FONT_PAIRS, PAPER, PAPER_TONES, RELIEF_MIN_DELTA_L } from './derive'
export type { ThemeWarning } from './derive'

type ThemeInput = BrandInput

// Cor da marca AgendaFlui (a padrão de conta nova). Fica aqui porque `src/shared` não importa de `src/ui`.
const PADRAO: Pick<ThemeInput, 'primary' | 'accent'> = { primary: '#0E4F5C', accent: '#E0A030' }

// O mesmo formato que `updateBrand` aceita: `#RRGGBB`, maiúsculas ou minúsculas.
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Prévia do tema de uma conta, sem servidor e sem tela: roda no navegador e no servidor. É a mesma `deriveTheme` que
 * o painel do negócio usa ao renderizar a marca, então `tokens` são exatamente as variáveis que ele aplica.
 * `theme` traz também material e fonte (para o `ThemeScope`) e `warnings` os sinais do motor, na ordem fixa.
 * Cor fora do formato do servidor (ainda sendo digitada, `#FFF`, sem `#`) usa a cor padrão da marca AgendaFlui e
 * acrescenta `invalid_color` no começo, para o formulário avisar em vez de mostrar o que o servidor vai recusar.
 */
export function previewTheme(i: ThemeInput): { tokens: Record<string, string>; warnings: ThemeWarning[]; theme: ThemeTokens } {
  const primariaOk = HEX.test(i.primary)
  const destaqueOk = HEX.test(i.accent)
  const theme = deriveTheme({
    ...i,
    primary: primariaOk ? i.primary : PADRAO.primary,
    accent: destaqueOk ? i.accent : PADRAO.accent,
  })
  const warnings: ThemeWarning[] = primariaOk && destaqueOk ? [...theme.signals] : ['invalid_color', ...theme.signals]
  return { tokens: { ...theme.vars }, warnings, theme }
}
