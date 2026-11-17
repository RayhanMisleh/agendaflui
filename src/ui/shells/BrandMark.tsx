import { cx } from '../components/cx'

export type BrandMarkVariant = 'horizontal' | 'symbol' | 'negative'

// Cores do símbolo da marca (logos/svg/agendaflui-simbolo*.svg). O ponto é sempre Caramelo.
const SYMBOL = {
  default: { body: '#0B6E66', rings: '#0F2A27', wave: '#F3F8F6' },
  negative: { body: '#3CC4B4', rings: '#E8F2EF', wave: '#0C1A18' },
} as const

/** O símbolo Agenda Flui: calendário com argolas, onda e ponto caramelo. Sem texto dentro do SVG. */
function AgendaFluiSymbol(p: { negative: boolean; label: string | null }) {
  const c = p.negative ? SYMBOL.negative : SYMBOL.default
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
 * `variant`: `horizontal` (símbolo e nome), `symbol` (só o símbolo) e `negative` (para fundo escuro ou na cor da conta:
 * símbolo claro, "flui" em `--on-brand`). O nome é texto de verdade, então o leitor de tela o lê.
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
    const onlySymbol = variant === 'symbol'
    return (
      <span className={cx('af-brand', `af-brand--${p.size}`, 'af-brand--agendaflui', negative && 'af-brand--negative')}>
        <AgendaFluiSymbol negative={negative} label={onlySymbol ? 'Agenda Flui' : null} />
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
        <span className="af-brand__name af-engraved">{p.name}</span>
      )}
    </span>
  )
}
