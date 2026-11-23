import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { getModuleUsage } from '@/server/domain/platform/module-usage'
import { carregarConta } from '../_data'
import { salvarModulos } from '../actions'
import { ModulosForm } from '../FormsConta'

export const metadata: Metadata = { title: 'Módulos da conta | Agenda Flui' }

export default async function ModulosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const [{ modules }, uso] = await Promise.all([getCustomization(admin, conta.id), getModuleUsage(admin, conta.id)])
  const on = (b: boolean) => (b ? 'on' : '')
  return (
    <Card className="af-listpanel">
      <h2 className="af-section__title">O que a conta usa além da agenda</h2>
      <ModulosForm
        action={salvarModulos.bind(null, conta.id)}
        businessId={conta.id}
        uso={uso}
        valores={{ loyalty: on(modules.loyalty), banners: on(modules.banners), store: on(modules.store), vouchers: on(modules.vouchers) }}
      />
    </Card>
  )
}
