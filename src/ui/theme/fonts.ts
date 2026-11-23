import localFont from 'next/font/local'

// O par da marca Agenda Flui, auto-hospedado (arquivos variáveis em ./fonts): Bricolage Grotesque nos títulos, Figtree no texto.
const bricolage = localFont({
  src: './fonts/BricolageGrotesque-Variable.ttf',
  weight: '200 800',
  display: 'swap',
  variable: '--font-bricolage',
})
const figtree = localFont({
  src: './fonts/Figtree-Variable.ttf',
  weight: '300 900',
  display: 'swap',
  variable: '--font-figtree',
})

/** Classes para o <html>. `--font-display` e `--font-sans` vêm do tema da conta (`deriveTheme`) e usam estas variáveis. */
export const fontVariables: string = [bricolage, figtree].map((f) => f.variable).join(' ')
