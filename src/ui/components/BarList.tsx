import { cx } from './cx'

export type BarItem = { key: string; label: string; value: number; display: string }

/**
 * Barras horizontais simples, só CSS, na cor da conta. A largura de cada barra é o valor sobre o maior da lista; o valor
 * também está escrito (nada só por cor ou tamanho). É uma lista ordenada de verdade: leitor de tela lê "rótulo, valor".
 */
export function BarList({ items, label, className }: { items: BarItem[]; label: string; className?: string }) {
  const maior = Math.max(0, ...items.map((i) => i.value))
  return (
    <ol className={cx('af-barlist', className)} aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="af-barlist__row">
          <span className="af-barlist__label">{i.label}</span>
          <span className="af-barlist__track" aria-hidden="true">
            <span className="af-barlist__fill" style={{ width: `${maior > 0 ? Math.max(i.value > 0 ? 2 : 0, (i.value / maior) * 100).toFixed(1) : '0'}%` }} />
          </span>
          <span className="af-barlist__value">{i.display}</span>
        </li>
      ))}
    </ol>
  )
}
