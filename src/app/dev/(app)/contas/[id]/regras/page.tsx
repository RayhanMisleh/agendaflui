import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { RULE_LIMITS, SLOT_STEPS } from '@/server/domain/settings/scheduling-rules'
import { carregarConta } from '../_data'
import { salvarAvisos, salvarRegras } from '../actions'
import { tiposDeAviso } from '@/app/_lib/avisos'
import { AvisosForm, RegrasForm } from '../FormsConta'

export const metadata: Metadata = { title: 'Regras da conta | Agenda Flui' }

export default async function RegrasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { rules, notifications } = await getCustomization(admin, conta.id)
  const lista = tiposDeAviso()
  const avisos: Record<string, string> = { version: String(rules.version) }
  for (const a of lista) {
    const canais = notifications[a.kind as keyof typeof notifications]
    avisos[`${a.kind}__email`] = canais?.email ? 'on' : ''
    avisos[`${a.kind}__push`] = canais?.push ? 'on' : ''
  }
  return (
    <>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Regras de agenda</h2>
        <RegrasForm
          key={rules.version}
          action={salvarRegras.bind(null, conta.id)}
          grades={SLOT_STEPS}
          limites={RULE_LIMITS}
          valores={{
            slotStepMin: String(rules.slotStepMin),
            minLeadMin: String(rules.minLeadMin),
            maxAdvanceDays: String(rules.maxAdvanceDays),
            customerChangeWindowMin: String(rules.customerChangeWindowMin),
            bufferMin: String(rules.bufferMin),
            autoConfirm: rules.autoConfirm ? 'on' : '',
            version: String(rules.version),
          }}
        />
      </Card>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Avisos por tipo e canal</h2>
        <p className="af-section__help">Desmarcar um canal para de mandar aquele aviso por ele nesta conta.</p>
        <AvisosForm key={rules.version} action={salvarAvisos.bind(null, conta.id)} valores={avisos} avisos={lista} />
      </Card>
    </>
  )
}
