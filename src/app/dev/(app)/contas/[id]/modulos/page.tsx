import type { Metadata } from 'next'
import { Paper } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { carregarConta } from '../_data'
import { ModulosForm } from '../Simple'

export const metadata: Metadata = { title: 'Módulos da conta | AgendaFlui' }

export default async function ModulosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { modules } = await getCustomization(admin, conta.id)
  const on = (b: boolean) => (b ? 'on' : '')
  return (
    <Paper raised={1} className="af-listpanel">
      <h2 className="af-section__title">O que a conta usa além da agenda</h2>
      <ModulosForm
        valores={{ businessId: conta.id, loyalty: on(modules.loyalty), banners: on(modules.banners), store: on(modules.store), vouchers: on(modules.vouchers) }}
      />
    </Paper>
  )
}
