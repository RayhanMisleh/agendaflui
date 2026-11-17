'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Ellipsis, Lock } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import { cx } from '../components/cx'
import { isNavActive } from './nav'

/** Item já com o ícone desenhado: componentes não atravessam a fronteira servidor/cliente. */
export type NavNode = {
  href: string
  label: string
  shortLabel?: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
}

/** Até 5 itens cabem na barra do celular; com mais, ficam 4 e o resto vai para "Mais". */
const MAX_BAR = 5
const KEEP_WITH_MORE = 4

function NavLink({ item, onNavigate }: { item: NavNode; onNavigate?: () => void }) {
  const inner = (
    <>
      <span className="af-navlink__icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="af-navlink__label af-navlink__label--full">{item.label}</span>
      {item.shortLabel ? <span className="af-navlink__label af-navlink__label--short" aria-hidden="true">{item.shortLabel}</span> : null}
      {item.disabled ? <Lock className="af-navlink__lock" size={14} aria-hidden="true" /> : null}
    </>
  )
  if (item.disabled) {
    return (
      <span className="af-navlink af-navlink--disabled" aria-disabled="true">
        {inner}
      </span>
    )
  }
  return (
    <Link
      href={item.href}
      className={cx('af-navlink', item.active && 'af-navlink--active')}
      aria-current={item.active ? 'page' : undefined}
      onClick={onNavigate}
    >
      {inner}
    </Link>
  )
}

/** Menu em linhas-pílula. No celular vira a barra flutuante da base, com "Mais" quando há muitos destinos. */
export function ShellNav({ items: given, userPlate }: { items: NavNode[]; userPlate: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname = usePathname()
  // `active` explícito vence; sem ele, a rota decide (e subpáginas ativam o destino pai).
  const items = given.map((i) => ({ ...i, active: i.active ?? (!i.disabled && pathname !== null && isNavActive(pathname, i.href)) }))
  const hasMore = items.length > MAX_BAR
  const keep = hasMore ? KEEP_WITH_MORE : items.length
  const overflow = items.slice(keep)
  const overflowActive = overflow.some((i) => i.active)

  return (
    <>
      <nav aria-label="Principal" className="af-shell__nav">
        <ul className="af-nav">
          {items.map((item, i) => (
            <li key={item.href + item.label} className={cx('af-nav__item', i >= keep && 'af-nav__item--overflow')}>
              <NavLink item={item} />
            </li>
          ))}
          {hasMore ? (
            <li className="af-nav__item af-nav__item--more">
              <button
                type="button"
                className={cx('af-navlink', overflowActive && 'af-navlink--active')}
                aria-haspopup="dialog"
                onClick={() => setMoreOpen(true)}
              >
                <span className="af-navlink__icon" aria-hidden="true">
                  <Ellipsis size={20} />
                </span>
                <span className="af-navlink__label">Mais</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      {hasMore ? (
        <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais">
          <div className="af-more__user">{userPlate}</div>
          <ul className="af-more__list">
            {overflow.map((item) => (
              <li key={item.href + item.label}>
                <NavLink item={item} onNavigate={() => setMoreOpen(false)} />
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </>
  )
}
