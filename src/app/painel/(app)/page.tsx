import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { roleLabel } from '@/server/auth/role-labels'
import { tenantDb } from '@/server/db/tenant'
import { formatDate, todayIn } from '@/server/time'
import { EmptyState } from '@/ui/components'
import { PainelFrame } from './PainelFrame'

export const metadata: Metadata = { title: 'Início | AgendaFlui' }

export default async function InicioPage() {
  const ctx = await requireTenant('view_dashboard')
  const agora = new Date()
  const hoje = todayIn(ctx.timeZone, agora)
  const nome = ctx.actor.kind === 'member' || ctx.actor.kind === 'impersonator' ? ctx.actor.name : ''
  const primeiroNome = nome.split(' ')[0] ?? ''
  const termos = await tenantDb(ctx.businessId).businessSettings.findFirst({ select: { termProfessionalSingular: true } })
  const papel = ctx.actor.kind === 'member' ? roleLabel(ctx.actor.role, termos?.termProfessionalSingular ?? 'Profissional') : 'Suporte'

  return (
    <PainelFrame ctx={ctx} title="Início">
      <div className="af-home">
        <h2 className="af-home__hello">Olá, {primeiroNome}</h2>
        <p className="af-home__meta">
          Hoje é <time dateTime={hoje}>{formatDate(agora, ctx.timeZone)}</time>. Você entra como {papel}.
        </p>
        <EmptyState
          title="A agenda chega na próxima etapa"
          description="Quando ela estiver pronta, os atendimentos do dia aparecem aqui."
        />
      </div>
    </PainelFrame>
  )
}
