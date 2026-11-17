import { useId } from 'react'
import { cx } from './cx'
import { formatInt } from '../format'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

type Cell = { key: string; char: string; kind: 'digit' | 'pad' | 'minor' | 'sep' | 'unit' }

function buildCells(text: string, minDigits: number): Cell[] {
  const chars = Array.from(text)
  const comma = chars.lastIndexOf(',')
  const cells: Cell[] = chars.map((char, i) => {
    const k = `r${chars.length - 1 - i}`
    if (/\d/.test(char)) return { key: k, char, kind: comma >= 0 && i > comma ? 'minor' : 'digit' }
    if (char === '.' || char === ',') return { key: k, char, kind: 'sep' }
    return { key: k, char: char === ' ' ? '' : char, kind: 'unit' }
  })
  const have = cells.filter((c) => c.kind === 'digit' || c.kind === 'minor').length
  const pad: Cell[] = []
  for (let j = 0; j < minDigits - have; j++) {
    pad.unshift({ key: `r${chars.length + j}`, char: '0', kind: 'pad' })
  }
  // Zeros de preenchimento ficam à esquerda do primeiro dígito, depois de sinais ou da unidade.
  const firstDigit = cells.findIndex((c) => c.kind === 'digit' || c.kind === 'minor')
  const at = firstDigit < 0 ? cells.length : firstDigit
  return [...cells.slice(0, at), ...pad, ...cells.slice(at)]
}

/**
 * Contador mecânico, um tambor por dígito. O valor visível é decoração (aria-hidden);
 * o leitor de tela lê o valor formatado.
 */
export function Counter({
  value,
  digits = 0,
  label,
  format = 'int',
  className,
}: {
  value: number
  digits?: number
  label: string
  format?: 'int' | 'brl'
  className?: string
}) {
  const uid = useId()
  const labelId = `${uid}-rotulo`
  const text = format === 'brl' ? BRL.format(value / 100) : formatInt(value)
  const cells = buildCells(text, digits)

  return (
    <div role="group" aria-labelledby={labelId} className={cx('af-counter', className)}>
      <div id={labelId} className="af-counter__label af-engraved">
        {label}
      </div>
      <span className="af-sr">{text}</span>
      <div className="af-counter__plate" aria-hidden="true">
        {cells.map((c) =>
          c.kind === 'sep' || c.kind === 'unit' ? (
            <span key={c.key} className={cx('af-counter__fixed', `af-counter__fixed--${c.kind}`)}>
              {c.char}
            </span>
          ) : (
            <span key={c.key} className={cx('af-drum', c.kind === 'minor' && 'af-drum--minor', c.kind === 'pad' && 'af-drum--pad')}>
              <span className="af-drum__strip" style={{ '--d': Number(c.char) } as React.CSSProperties}>
                {DIGITS.map((d) => (
                  <span key={d} className="af-drum__digit">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ),
        )}
      </div>
    </div>
  )
}
