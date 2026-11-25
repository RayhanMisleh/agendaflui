'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from './cx'

export type NavTabItem = { id: string; label: string; href: string; /** Só a rota exata marca a aba (o resumo não é pai das outras). */ exact?: boolean; /** Decide a aba atual no lugar da rota (filtros por parâmetro da URL, que compartilham o mesmo caminho). */ active?: boolean }

/**
 * Pílulas que são links: cada aba é uma rota, então a aba atual sai da URL (`aria-current="page"`),
 * o botão voltar funciona e nada depende de JavaScript para navegar. O aspecto é o mesmo de `Tabs`.
 */
export function NavTabs({ items, label, className }: { items: NavTabItem[]; label: string; className?: string }) {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)
  // Na fileira que rola (celular), a aba atual vem para o centro: quem abre "Bloqueios" não a encontra cortada na borda.
  const chaveAtual = items.map((i) => (i.active ?? (pathname === i.href || (!i.exact && pathname.startsWith(`${i.href}/`))) ? i.id : '')).join('')
  useEffect(() => {
    const barra = nav.current
    const atual = barra?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!barra || !atual || barra.scrollWidth <= barra.clientWidth) return
    barra.scrollLeft = atual.offsetLeft - (barra.clientWidth - atual.offsetWidth) / 2
  }, [chaveAtual])
  return (
    <nav ref={nav} aria-label={label} className={cx('af-tabs af-navtabs', className)}>
      {items.map((item) => {
        const ativa = item.active ?? (pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`)))
        return (
          <Link key={item.id} href={item.href} className={cx('af-tab', ativa && 'af-tab--active')} aria-current={ativa ? 'page' : undefined}>
            <span className="af-tab__label">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
