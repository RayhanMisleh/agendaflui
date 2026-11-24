import type { Metadata } from 'next'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { getAgendaPage } from '@/server/domain/scheduling/agenda-page'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { AgendaPainel } from './AgendaPainel'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Agenda | Agenda Flui' }

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('view_own_agenda')
  const q = await searchParams
  const [page] = await Promise.all([
    getAgendaPage(ctx, { visao: um(q.visao), data: um(q.data), profissional: um(q.profissional) }),
    getPainelContext(ctx),
  ])
  const acao = um(q.acao)
  return (
    <PainelFrame ctx={ctx} title="Agenda">
      <AgendaPainel
        page={page}
        termos={{ customerSingular: TERMS.customerSingular, professionalSingular: TERMS.professionalSingular, professionalPlural: TERMS.professionalPlural }}
        agendamento={um(q.ag) || null}
        abrir={acao === 'marcar' || acao === 'bloquear' ? acao : null}
        podeBloquear={can(ctx.actor, 'manage_own_availability')}
        podeCadastrar={can(ctx.actor, 'manage_clients')}
      />
    </PainelFrame>
  )
}
