import { deriveTheme, type BrandInput, type ThemeTokens, type ThemeWarning } from './derive'

export { COVER_MATERIALS, SIDEBAR_GROUND_MIN_CONTRAST } from './derive'
export type { ThemeWarning } from './derive'

type ThemeInput = BrandInput

// Cores da marca Agenda Flui, Água e Caramelo (as padrão de conta nova). Fica aqui porque `src/shared` não importa de `src/ui`.
const PADRAO: Pick<ThemeInput, 'primary' | 'accent'> = { primary: '#0B6E66', accent: '#F2A93B' }

// O mesmo formato que `updateBrand` aceita: `#RRGGBB`, maiúsculas ou minúsculas.
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Prévia do tema de uma conta, sem servidor e sem tela: roda no navegador e no servidor. É a mesma `deriveTheme` que
 * o painel do negócio usa ao renderizar a marca, então `tokens` são exatamente as variáveis que ele aplica.
 * `theme` traz também material e fonte (para o `ThemeScope`) e `warnings` os sinais do motor, na ordem fixa.
 * Cor fora do formato do servidor (ainda sendo digitada, `#FFF`, sem `#`) usa a cor padrão da marca Agenda Flui e
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
