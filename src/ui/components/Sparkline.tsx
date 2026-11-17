import { cx } from './cx'

const W = 120
const H = 32
const PAD = 3

/**
 * Linha pequena de uma série (SVG próprio, sem biblioteca). A imagem leva nome e resumo em texto com os números, e o último
 * ponto ganha um marcador: ler o gráfico não depende de cor. Série vazia ou de um ponto desenha o que dá e não quebra.
 */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const finitos = values.filter((v) => Number.isFinite(v))
  const resumo = finitos.length === 0 ? `${label}: nenhum valor para mostrar` : `${label}: ${finitos.join(', ')}`
  const min = Math.min(...finitos)
  const max = Math.max(...finitos)
  const span = max - min
  const x = (i: number): number => (finitos.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (finitos.length - 1))
  // Série sem variação fica no meio da altura.
  const y = (v: number): number => (span === 0 ? H / 2 : H - PAD - ((v - min) * (H - 2 * PAD)) / span)
  const pontos = finitos.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
  const ultimo = finitos.length > 0 ? { cx: x(finitos.length - 1), cy: y(finitos[finitos.length - 1] ?? 0) } : null
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={resumo}
      className={cx('af-spark', className)}
      focusable="false"
    >
      <title>{resumo}</title>
      <line className="af-spark__base" x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} />
      {pontos.length > 1 ? <path className="af-spark__line" d={`M${pontos.join(' L')}`} fill="none" /> : null}
      {ultimo ? <circle className="af-spark__dot" cx={ultimo.cx} cy={ultimo.cy} r="3" /> : null}
    </svg>
  )
}
