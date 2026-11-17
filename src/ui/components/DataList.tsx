'use client'
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'

export type DataColumn<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  primary?: boolean
  /** Célula e cabeçalho numa linha só (telefone, data, valor). */
  nowrap?: boolean
  /** Alinhamento na tabela; `end` para números. */
  align?: 'start' | 'end'
}

function colClass(c: { nowrap?: boolean; align?: 'start' | 'end' }): string | undefined {
  return cx(c.nowrap && 'af-col--nowrap', c.align === 'end' && 'af-col--end') || undefined
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
 * Tabela dentro de um Card quando o CONTÊINER da lista tem ao menos 36rem (576 px); abaixo disso, lista de cartões
 * com a coluna `primary` como título. Quem decide é a largura da folha, não a da tela.
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
              <th key={c.key} scope="col" className={colClass(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} data-clickable={onRowClick ? '' : undefined}>
              {columns.map((c, i) => (
                <td key={c.key} className={cx(colClass(c), onRowClick && i === primaryIdx && 'af-cell-hit') || undefined}>
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
              className={cx('af-datalist__item', onRowClick && 'af-datalist__item--clickable')}
              {...(onRowClick ? hitProps(() => onRowClick(row)) : {})}
            >
              {primary ? <div className="af-datalist__title">{primary.cell(row)}</div> : null}
              <dl className="af-datalist__fields">
                {others.map((c) => (
                  <div key={c.key} className="af-datalist__field">
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
