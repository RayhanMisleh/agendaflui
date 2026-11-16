import type { Metadata } from 'next'
import { ArrowRight, Plus } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { listBusinesses } from '@/server/domain/platform/businesses'
import { EmptyState, LinkButton, Paper } from '@/ui/components'
import { ContasTable } from './contas/ContasTable'
import { DevFrame } from './DevFrame'

export const metadata: Metadata = { title: 'Visão geral | AgendaFlui' }

export default async function VisaoGeralPage() {
  const admin = await requirePlatformAdmin()
  const { items } = await listBusinesses(admin, { limit: 5 })
  const contas = items.map((c) => ({ id: c.id, name: c.name, slug: c.slug, status: c.status, ownerName: c.ownerName, entrada: c.entryUrl }))
  return (
    <DevFrame
      admin={admin}
      title="Visão geral"
      actions={
        <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
          Criar conta
        </LinkButton>
      }
    >
      <div className="af-home">
        <h2 className="af-home__hello af-home__hello--dev">Contas mais recentes</h2>
        <p className="af-home__meta af-home__meta--dev af-on-cover-text">
          Cada conta entra pelo próprio link, já com a marca dela. Copie o link e envie a quem vai usar.
        </p>
        <Paper raised={1} className="af-listpanel">
          <ContasTable
            contas={contas}
            vazio={
              <EmptyState
                title="Nenhuma conta ainda"
                description="Crie a primeira conta: você escolhe a marca, os termos e o dono, e o link de entrada fica pronto."
                action={
                  <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
                    Criar a primeira conta
                  </LinkButton>
                }
              />
            }
          />
          {contas.length > 0 ? (
            <p className="af-home__row">
              <LinkButton href="/contas" icon={<ArrowRight size={18} />}>
                Ver todas as contas
              </LinkButton>
            </p>
          ) : null}
        </Paper>
        <p className="af-home__row">
          <LinkButton href="/vitrine">Vitrine de componentes</LinkButton>
        </p>
      </div>
    </DevFrame>
  )
}
