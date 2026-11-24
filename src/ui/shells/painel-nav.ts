import { CalendarDays, ChartNoAxesColumn, Gift, House, Images, Scissors, ShoppingBag, Settings, UserRound, UserRoundCog, Users } from 'lucide-react'
import type { Capability } from '@/server/auth/capabilities'
import type { Modules } from '@/shared/modules'
import { TERMS } from '@/shared/terms'
import type { NavItem } from './nav'

/**
 * Os destinos do painel do negócio para quem tem cada capacidade, na ordem do desenho. Quem só vê os próprios números lê "Meus números", e quem não
 * gerencia as configurações da conta chega ao seu perfil por "Meu perfil" (Minha conta, em `/conta`). Os módulos opcionais (Fidelidade,
 * Banners, Loja) entram depois de Serviços, cada um só com o módulo ligado E a capacidade de gerenciá-lo.
 */
export function painelNav(ctx: { can(c: Capability): boolean; modules: Modules }): NavItem[] {
  const { can, modules } = ctx
  const items: (NavItem | null)[] = [
    can('view_dashboard') ? { href: '/painel', label: 'Início', icon: House, exact: true } : null,
    can('view_own_agenda') ? { href: '/painel/agenda', label: 'Agenda', icon: CalendarDays } : null,
    can('view_clients') ? { href: '/painel/clientes', label: TERMS.customerPlural, icon: Users } : null,
    can('manage_team') ? { href: '/painel/equipe', label: TERMS.professionalPlural, icon: UserRound } : null,
    can('manage_catalog') ? { href: '/painel/servicos', label: 'Serviços', icon: Scissors } : null,
    modules.loyalty && can('manage_loyalty') ? { href: '/painel/fidelidade', label: 'Fidelidade', icon: Gift } : null,
    modules.banners && can('manage_banners') ? { href: '/painel/banners', label: 'Banners', icon: Images } : null,
    modules.store && can('manage_store') ? { href: '/painel/loja', label: 'Loja', icon: ShoppingBag } : null,
    can('view_all_reports')
      ? { href: '/painel/relatorios', label: 'Relatórios', icon: ChartNoAxesColumn }
      : can('view_own_reports')
        ? { href: '/painel/relatorios', label: 'Meus números', shortLabel: 'Números', icon: ChartNoAxesColumn }
        : null,
    can('manage_settings')
      ? { href: '/painel/configuracoes', label: 'Configurações', shortLabel: 'Ajustes', icon: Settings }
      : can('view_dashboard')
        ? { href: '/conta', label: 'Meu perfil', shortLabel: 'Perfil', icon: UserRoundCog }
        : null,
  ]
  return items.filter((i): i is NavItem => i !== null)
}
