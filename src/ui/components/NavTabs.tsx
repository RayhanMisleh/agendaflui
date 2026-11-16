'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from './cx'

export type NavTabItem = { id: string; label: string; href: string; /** Só a rota exata marca a aba (o resumo não é pai das outras). */ exact?: boolean }

/**
 * Divisórias de fichário que são links: cada aba é uma rota, então a aba atual sai da URL (`aria-current="page"`),
 * o botão voltar funciona e nada depende de JavaScript para navegar. O aspecto é o mesmo de `Tabs`.
 */
export function NavTabs({ items, label, className }: { items: NavTabItem[]; label: string; className?: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label={label} className={cx('af-tabs af-navtabs', className)}>
      {items.map((item) => {
        const ativa = pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))
        return (
          <Link key={item.id} href={item.href} className={cx('af-tab', ativa && 'af-tab--active')} aria-current={ativa ? 'page' : undefined}>
            <span className="af-tab__label">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
