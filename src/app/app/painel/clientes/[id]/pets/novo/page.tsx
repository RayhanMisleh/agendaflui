import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getCustomer } from '@/server/domain/customers/customers'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, EmptyState, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../../../PainelFrame'
import { PetForm } from '../PetForm'

export const metadata: Metadata = { title: 'Novo pet | Agenda Flui' }

export default async function NovoPetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant('manage_clients')
  const { id } = await params
  const [cliente, painel] = await Promise.all([
    getCustomer(ctx, id).catch((err: unknown) => {
      if (err instanceof DomainError && err.code === 'not_found') notFound()
      throw err
    }),
    getPainelContext(ctx),
  ])
  if (painel.niche === null) notFound()
  const voltar = (
    <LinkButton href={`/painel/clientes/${cliente.id}`} variant="ghost">
      Voltar para {cliente.name}
    </LinkButton>
  )
  return (
    <PainelFrame ctx={ctx} title="Novo pet" actions={voltar}>
      {cliente.archived ? (
        <Card as="section" aria-label="Cliente arquivado">
          <EmptyState title="Este cliente está arquivado" description="Restaure o cadastro antes de adicionar pets." action={voltar} />
        </Card>
      ) : (
        <Card as="section" aria-label="Dados do pet" className="af-profile af-profile--narrow">
          <PetForm customerId={cliente.id} pet={null} servesCats={painel.niche.servesCats} />
        </Card>
      )}
    </PainelFrame>
  )
}
