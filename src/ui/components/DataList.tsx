'use client'
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'

export type DataColumn<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  primary?: boolean
}

function hitProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  }
}

/**
 * Tabela em papel pautado a partir de 768 px; abaixo disso, lista de cartões com a coluna `primary` como título.
 * As duas versões ficam no HTML e o CSS alterna entre elas.
 */
export function DataList<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  label,
  className,
}: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  empty: ReactNode
  label?: string
  className?: string
}) {
  if (rows.length === 0) return <>{empty}</>

  const primaryIdx = Math.max(0, columns.findIndex((c) => c.primary))
  const primary = columns[primaryIdx]
  const others = columns.filter((_, i) => i !== primaryIdx)

  return (
    <div className={cx('af-datalist', className)}>
      <table className="af-datalist__table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} data-clickable={onRowClick ? '' : undefined}>
              {columns.map((c, i) => (
                <td key={c.key} className={onRowClick && i === primaryIdx ? 'af-cell-hit' : undefined}>
                  {onRowClick && i === primaryIdx ? (
                    <div className="af-row-hit" {...hitProps(() => onRowClick(row))}>
                      {c.cell(row)}
                    </div>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="af-datalist__cards" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              className={cx('af-card', onRowClick && 'af-card--clickable')}
              {...(onRowClick ? hitProps(() => onRowClick(row)) : {})}
            >
              {primary ? <div className="af-card__title">{primary.cell(row)}</div> : null}
              <dl className="af-card__fields">
                {others.map((c) => (
                  <div key={c.key} className="af-card__field">
                    <dt>{c.header}</dt>
                    <dd>{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
