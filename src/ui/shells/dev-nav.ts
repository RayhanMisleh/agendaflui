import { Building2, LayoutDashboard, ScrollText, Server, ShieldCheck } from 'lucide-react'
import type { NavItem } from './nav'

export { isNavActive } from './nav'

/**
 * Os cinco destinos do painel dev. O item ativo sai da rota (ver `isNavActive`), não de um campo fixo.
 */
export const DEV_NAV: NavItem[] = [
  { href: '/', label: 'Visão geral', shortLabel: 'Geral', icon: LayoutDashboard },
  { href: '/contas', label: 'Contas', icon: Building2 },
  { href: '/sistema', label: 'Sistema', icon: Server },
  { href: '/auditoria', label: 'Auditoria', icon: ScrollText },
  { href: '/admins', label: 'Admins', icon: ShieldCheck },
]
