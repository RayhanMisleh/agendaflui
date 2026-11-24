'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '../components/cx'
import { clienteNav } from './cliente-nav'

/**
 * Navegação da área do cliente. A moldura monta duas (uma só aparece por vez, pelo CSS): `bottom`, a pílula flutuante do
 * celular, fora da barra do topo (que leva nome de transição); `top`, os links na barra do topo no computador.
 */
export function ClienteNavBar({ slug, pets, placement }: { slug: string; pets: boolean; placement: 'top' | 'bottom' }) {
  const pathname = usePathname() ?? `/${slug}`
  const itens = clienteNav(slug, { pets }, pathname)
  return (
    <nav aria-label="Principal" className={cx('af-cl-nav', `af-cl-nav--${placement}`)}>
      <ul className="af-nav">
        {itens.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.href} className="af-nav__item">
              <Link href={item.href} className={cx('af-navlink', item.active && 'af-navlink--active')} aria-current={item.active ? 'page' : undefined}>
                <span className="af-navlink__icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={2} />
                </span>
                <span className="af-navlink__label">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
