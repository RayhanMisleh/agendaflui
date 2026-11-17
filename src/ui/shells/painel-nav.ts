import { CalendarDays, ChartNoAxesColumn, House, Scissors, Settings, UserRound, UserRoundCog, Users } from 'lucide-react'
import type { Capability } from '@/server/auth/capabilities'
import type { Modules } from '@/shared/modules'
import type { NavItem } from './nav'

/**
 * Os destinos do painel do negócio para quem tem cada capacidade, na ordem do desenho. O rótulo de Clientes e de
 * Equipe segue os termos da conta ("Tutores", "Tosadores"). Quem só vê os próprios números lê "Meus números", e quem não
 * gerencia as configurações da conta chega ao seu perfil por "Meu perfil" (mesma rota). Os módulos opcionais são da Fase 5:
 * ainda não criam destinos, por isso `modules` só marca o lugar onde eles entram.
 */
export function painelNav(ctx: { can(c: Capability): boolean; modules: Modules; terms: { customerPlural: string; professionalPlural: string } }): NavItem[] {
  const { can, terms } = ctx
  const items: (NavItem | null)[] = [
    can('view_dashboard') ? { href: '/', label: 'Início', icon: House } : null,
    can('view_own_agenda') ? { href: '/agenda', label: 'Agenda', icon: CalendarDays } : null,
    can('view_clients') ? { href: '/clientes', label: terms.customerPlural, icon: Users } : null,
    can('manage_team') ? { href: '/equipe', label: terms.professionalPlural, icon: UserRound } : null,
    can('manage_catalog') ? { href: '/servicos', label: 'Serviços', icon: Scissors } : null,
    can('view_all_reports')
      ? { href: '/relatorios', label: 'Relatórios', icon: ChartNoAxesColumn }
      : can('view_own_reports')
        ? { href: '/relatorios', label: 'Meus números', shortLabel: 'Números', icon: ChartNoAxesColumn }
        : null,
    can('manage_settings')
      ? { href: '/configuracoes', label: 'Configurações', shortLabel: 'Ajustes', icon: Settings }
      : can('view_dashboard')
        ? { href: '/configuracoes', label: 'Meu perfil', shortLabel: 'Perfil', icon: UserRoundCog }
        : null,
  ]
  return items.filter((i): i is NavItem => i !== null)
}
