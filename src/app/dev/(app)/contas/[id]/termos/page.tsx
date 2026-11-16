import type { Metadata } from 'next'
import { Paper } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { carregarConta } from '../_data'
import { TermosForm } from '../Simple'

export const metadata: Metadata = { title: 'Termos da conta | AgendaFlui' }

export default async function TermosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { terms } = await getCustomization(admin, conta.id)
  return (
    <Paper raised={1} className="af-listpanel">
      <h2 className="af-section__title">Como a conta chama as pessoas e os pontos</h2>
      <p className="af-section__help">Os termos aparecem nas telas, nos e-mails e na API desta conta.</p>
      <TermosForm valores={{ businessId: conta.id, ...terms }} />
    </Paper>
  )
}
