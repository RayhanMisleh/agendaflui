import type { Metadata } from 'next'
import { getIntegrations } from '@/server/domain/platform/integrations'
import { HorariosNota } from '../../../_lib/HorariosNota'
import { carregarConta } from '../_data'
import { IntegracoesForms } from './IntegracoesForms'
import { removerFrenet, removerMercadoPago, salvarFrenet, salvarMercadoPago } from './actions'

export const metadata: Metadata = { title: 'Integrações da conta | Agenda Flui' }

export default async function IntegracoesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const dados = await getIntegrations(admin, conta.id)
  return (
    <>
      <HorariosNota />
      <IntegracoesForms
        dados={dados}
        acoes={{
          salvarMercadoPago: salvarMercadoPago.bind(null, conta.id),
          removerMercadoPago: removerMercadoPago.bind(null, conta.id),
          salvarFrenet: salvarFrenet.bind(null, conta.id),
          removerFrenet: removerFrenet.bind(null, conta.id),
        }}
      />
    </>
  )
}
