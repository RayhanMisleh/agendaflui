'use client'
import { isValidElement } from 'react'
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

/** Verdadeiro quando o cabeçalho tem texto para ler: vazio e ícone sozinho (sem texto dentro) não têm. */
function temTexto(node: ReactNode): boolean {
  if (typeof node === 'string') return node.trim() !== ''
  if (typeof node === 'number') return true
  if (Array.isArray(node)) return node.some(temTexto)
  if (isValidElement<{ children?: ReactNode }>(node)) return temTexto(node.props.children)
  return false
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

/** Largura do contêiner a partir da qual a lista vira tabela: `sm` 28 rem, `md` 36 rem (o padrão), `lg` 48 rem. */
export type DataListStack = 'sm' | 'md' | 'lg'

/**
 * Uma tabela só, desenhada pelo CSS de duas formas conforme a largura do CONTÊINER da lista (não a da tela): tabela
 * a partir do limite (`stack`, 36 rem por padrão) e, abaixo dele, uma pilha de cartões com a coluna `primary` como título
 * e o cabeçalho de cada coluna como rótulo da célula. Cada célula é desenhada uma vez (nada de duas listas no HTML).
 * Os papéis ARIA ficam explícitos para a semântica de tabela sobreviver à troca de aparência.
 */
export function DataList<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  label,
  className,
  stack = 'md',
}: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  empty: ReactNode
  label?: string
  className?: string
  stack?: DataListStack
}) {
  if (rows.length === 0) return <>{empty}</>

  const primaryIdx = Math.max(0, columns.findIndex((c) => c.primary))

  return (
    <div className={cx('af-datalist', className)} data-stack={stack}>
      <table className="af-datalist__table" role="table" aria-label={label}>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((c) => (
              <th key={c.key} role="columnheader" scope="col" className={colClass(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row" data-clickable={onRowClick ? '' : undefined}>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  role="cell"
                  data-primary={i === primaryIdx ? '' : undefined}
                  className={cx(colClass(c), onRowClick && i === primaryIdx && 'af-cell-hit') || undefined}
                >
                  {i === primaryIdx || !temTexto(c.header) ? null : (
                    <span className="af-datalist__label">{c.header}</span>
                  )}
                  {onRowClick && i === primaryIdx ? (
                    <div className="af-row-hit" {...hitProps(() => onRowClick(row))}>
                      {c.cell(row)}
                    </div>
                  ) : (
                    <div className="af-datalist__value">{c.cell(row)}</div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
