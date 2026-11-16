import type { ReactNode } from 'react'
import { CalendarDays, ChartNoAxesColumn, House, Scissors, Settings, UserRound, Users } from 'lucide-react'
import { requireMemberSession } from '@/server/auth/guards'
import type { TenantContext } from '@/server/auth/actor'
import { roleLabel } from '@/server/auth/role-labels'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { LinkButton } from '@/ui/components'
import { PainelShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'
import { redirect } from 'next/navigation'
import { EncerrarSuporte } from '../EncerrarSuporte'
import { SairDaConta } from '../SairDaConta'

/** Moldura do painel do negócio com a marca, os termos e o usuário da conta ativa. */
export async function PainelFrame({
  ctx,
  title,
  children,
}: {
  ctx: TenantContext
  title: string
  children: ReactNode
}) {
  const [session, marca, termos] = await Promise.all([
    requireMemberSession(),
    getPublicBrandById(ctx.businessId),
    ctx.db.businessSettings.findFirst(),
  ])
  if (!marca || !termos) redirect('/escolher-conta')

  const nav: NavItem[] = [
    { href: '/', label: 'Início', icon: House, active: true },
    { href: '/agenda', label: 'Agenda', icon: CalendarDays, disabled: true },
    { href: '/clientes', label: termos.termCustomerPlural, icon: Users, disabled: true },
    { href: '/equipe', label: termos.termProfessionalPlural, icon: UserRound, disabled: true },
    { href: '/servicos', label: 'Serviços', icon: Scissors, disabled: true },
    { href: '/relatorios', label: 'Relatórios', icon: ChartNoAxesColumn, disabled: true },
    { href: '/configuracoes', label: 'Configurações', icon: Settings, disabled: true },
  ]

  const papel =
    ctx.actor.kind === 'member' ? roleLabel(ctx.actor.role, termos.termProfessionalSingular) : 'Suporte'
  const suporte = ctx.actor.kind === 'impersonator'
  const nome = ctx.actor.kind === 'member' || ctx.actor.kind === 'impersonator' ? ctx.actor.name : session.user.name

  return (
    <PainelShell
      theme={marca.theme}
      brand={{ name: marca.name, logoUrl: marca.logoUrl, symbolUrl: marca.symbolUrl }}
      nav={nav}
      user={{ name: nome, roleLabel: papel, avatarUrl: null }}
      title={title}
      {...(suporte ? { supportBanner: `Você está em modo suporte na conta ${marca.name}`, supportAction: <EncerrarSuporte /> } : {})}
      actions={
        suporte ? null : (
          <>
            {session.memberships.length > 1 ? <LinkButton href="/escolher-conta">Trocar de conta</LinkButton> : null}
            <SairDaConta />
          </>
        )
      }
    >
      {children}
    </PainelShell>
  )
}
