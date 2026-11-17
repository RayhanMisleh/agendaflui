import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { carregarConta } from '../_data'
import { salvarTermos } from '../actions'
import { TermosForm } from '../FormsConta'

export const metadata: Metadata = { title: 'Termos da conta | AgendaFlui' }

export default async function TermosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { terms, rules } = await getCustomization(admin, conta.id)
  return (
    <Card className="af-listpanel">
      <h2 className="af-section__title">Como a conta chama as pessoas e os pontos</h2>
      <p className="af-section__help">Os termos aparecem nas telas, nos e-mails e na API desta conta.</p>
      <TermosForm action={salvarTermos.bind(null, conta.id)} valores={{ ...terms, version: String(rules.version) }} />
    </Card>
  )
}
