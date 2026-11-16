import { Building2, KeyRound, LayoutDashboard, ScrollText, Server, ShieldCheck } from 'lucide-react'
import type { NavItem } from './nav'

export { isNavActive } from './nav'

/**
 * Os seis destinos do painel dev. O item ativo sai da rota (ver `isNavActive`), não de um campo fixo.
 * `disabled` até a tela existir: as tarefas seguintes da fase ligam cada destino.
 */
export const DEV_NAV: NavItem[] = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/contas', label: 'Contas', icon: Building2 },
  { href: '/chaves', label: 'Chaves e API', icon: KeyRound, disabled: true },
  { href: '/sistema', label: 'Sistema', icon: Server, disabled: true },
  { href: '/auditoria', label: 'Auditoria', icon: ScrollText, disabled: true },
  { href: '/admins', label: 'Admins', icon: ShieldCheck, disabled: true },
]
