import { cx } from './cx'

const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const BAR_W = 36
const GAP = 12
const H = 44

/**
 * Barras pequenas para comparar poucos valores (SVG próprio). A imagem leva nome e resumo em texto; a legenda visível mostra
 * rótulo e valor de cada barra, então a leitura não depende de cor. A última barra é a de destaque (traço cheio); as outras
 * têm o mesmo desenho, só mais leve. Tudo zero ou lista vazia não quebra.
 */
export function MiniBars({
  bars,
  label,
  format = (n: number) => INT.format(n),
  className,
}: {
  bars: Array<{ label: string; value: number }>
  label: string
  format?: (n: number) => string
  className?: string
}) {
  const validas = bars.filter((b) => Number.isFinite(b.value) && b.value >= 0)
  const resumo = validas.length === 0 ? `${label}: nenhum valor para mostrar` : `${label}. ${validas.map((b) => `${b.label}: ${format(b.value)}`).join('; ')}`
  const max = Math.max(0, ...validas.map((b) => b.value))
  const largura = Math.max(1, validas.length) * BAR_W + Math.max(0, validas.length - 1) * GAP
  return (
    <figure className={cx('af-minibars', className)}>
      <svg viewBox={`0 0 ${largura} ${H}`} role="img" aria-label={resumo} className="af-minibars__svg" focusable="false">
        <title>{resumo}</title>
        <line className="af-minibars__base" x1="0" x2={largura} y1={H - 0.5} y2={H - 0.5} />
        {validas.map((b, i) => {
          // Valor positivo sempre aparece (altura mínima de 3); zero fica só na linha de base.
          const h = max === 0 || b.value === 0 ? 0 : Math.max(3, (b.value / max) * (H - 4))
          return (
            <rect
              key={`${b.label}-${i}`}
              className={cx('af-minibars__bar', i === validas.length - 1 && 'af-minibars__bar--main')}
              x={i * (BAR_W + GAP)}
              y={H - 1 - h}
              width={BAR_W}
              height={h}
              rx="2"
            />
          )
        })}
      </svg>
      <figcaption className="af-minibars__legend" aria-hidden="true">
        {validas.map((b, i) => (
          <span key={`${b.label}-${i}`} className={cx('af-minibars__item', i === validas.length - 1 && 'af-minibars__item--main')}>
            <span className="af-minibars__value">{format(b.value)}</span>
            <span className="af-minibars__name">{b.label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
