import { cx } from '../components/cx'

export type BrandMarkVariant = 'horizontal' | 'symbol' | 'negative' | 'on-color'

// Cores do símbolo da marca (logos/svg/agendaflui-simbolo*.svg). O ponto é sempre Caramelo.
const SYMBOL = {
  default: { body: '#0B6E66', rings: '#0F2A27', wave: '#F3F8F6' },
  negative: { body: '#3CC4B4', rings: '#E8F2EF', wave: '#0C1A18' },
} as const

/**
 * O símbolo Agenda Flui: calendário com argolas, onda e ponto caramelo. Sem texto dentro do SVG.
 * `onColor` pinta o corpo com `--mark-ink` e a onda com `--mark-bg` (a tinta e a cor do fundo onde o símbolo está):
 * serve sobre a cor da conta (bloco de destaque) e sobre a barra lateral Cheia ou Noite.
 */
function AgendaFluiSymbol(p: { negative: boolean; onColor: boolean; label: string | null }) {
  const c = p.negative ? SYMBOL.negative : SYMBOL.default
  if (p.onColor) {
    return (
      <svg
        viewBox="0 0 64 64"
        className="af-brand__symbol"
        {...(p.label ? { role: 'img', 'aria-label': p.label } : { 'aria-hidden': true })}
        focusable="false"
      >
        <rect x="4" y="9" width="56" height="51" rx="16" style={{ fill: 'var(--mark-ink, #FFFFFF)' }} />
        <rect x="16.5" y="3" width="7" height="14" rx="3.5" style={{ fill: 'var(--mark-ink, #FFFFFF)' }} />
        <rect x="40.5" y="3" width="7" height="14" rx="3.5" style={{ fill: 'var(--mark-ink, #FFFFFF)' }} />
        <path d="M14 43c6-9 12-9 18 0s12 9 18 0" fill="none" strokeWidth="6" strokeLinecap="round" style={{ stroke: 'var(--mark-bg, #0B6E66)' }} />
        <circle cx="46" cy="26" r="5.5" fill="#F2A93B" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 64 64"
      className="af-brand__symbol"
      {...(p.label ? { role: 'img', 'aria-label': p.label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <rect x="4" y="9" width="56" height="51" rx="16" fill={c.body} />
      <rect x="16.5" y="3" width="7" height="14" rx="3.5" fill={c.rings} />
      <rect x="40.5" y="3" width="7" height="14" rx="3.5" fill={c.rings} />
      <path d="M14 43c6-9 12-9 18 0s12 9 18 0" fill="none" stroke={c.wave} strokeWidth="6" strokeLinecap="round" />
      <circle cx="46" cy="26" r="5.5" fill="#F2A93B" />
    </svg>
  )
}

/**
 * A marca no topo das telas. Com logo da conta, a logo; sem logo, o nome da conta. Com `platform` (a própria
 * Agenda Flui: painel dev, entrada genérica), o símbolo da marca e o nome "agenda flui" em HTML, na fonte de títulos.
 * `variant`: `horizontal` (símbolo e nome), `symbol` (só o símbolo), `negative` (fundo escuro: símbolo em água clara) e
 * `on-color` (sobre a cor da conta ou a barra lateral: símbolo e nome em `--mark-ink`, que o contêiner define).
 * O nome é texto de verdade, então o leitor de tela o lê.
 */
export function BrandMark(p: {
  name: string
  logoUrl: string | null
  size: 'sm' | 'md' | 'lg'
  platform?: boolean | undefined
  variant?: BrandMarkVariant | undefined
}) {
  if (!p.logoUrl && p.platform) {
    const variant = p.variant ?? 'horizontal'
    const negative = variant === 'negative'
    const onColor = variant === 'on-color'
    const onlySymbol = variant === 'symbol'
    return (
      <span className={cx('af-brand', `af-brand--${p.size}`, 'af-brand--agendaflui', negative && 'af-brand--negative', onColor && 'af-brand--on-color')}>
        <AgendaFluiSymbol negative={negative} onColor={onColor} label={onlySymbol ? 'Agenda Flui' : null} />
        {onlySymbol ? null : (
          <span className="af-brand__wordmark">
            agenda <span className="af-brand__flui">flui</span>
          </span>
        )}
      </span>
    )
  }
  return (
    <span className={cx('af-brand', `af-brand--${p.size}`)}>
      {p.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a logo vem do armazenamento da conta; sem otimização aqui
        <img src={p.logoUrl} alt={p.name} className="af-brand__logo" />
      ) : (
        <span className="af-brand__name">{p.name}</span>
      )}
    </span>
  )
}
