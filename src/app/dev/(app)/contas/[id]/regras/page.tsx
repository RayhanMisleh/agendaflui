import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { getCustomization } from '@/server/domain/platform/customization'
import { RULE_LIMITS, SLOT_STEPS } from '@/server/domain/settings/scheduling-rules'
import { timeZoneChoices } from '@/server/time'
import { FUSOS } from '../../nova/fields'
import { carregarConta } from '../_data'
import { salvarAvisos, salvarRegras } from '../actions'
import { tiposDeAviso } from '../avisos'
import { AvisosForm, RegrasForm } from '../FormsConta'

export const metadata: Metadata = { title: 'Regras da conta | AgendaFlui' }

export default async function RegrasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const { rules, timeZone, notifications } = await getCustomization(admin, conta.id)
  const { top, rest } = timeZoneChoices(FUSOS.map((f) => f.value))
  const fusos = { top: FUSOS.filter((f) => top.includes(f.value)), rest }
  const lista = tiposDeAviso()
  const avisos: Record<string, string> = {}
  for (const a of lista) {
    const canais = notifications[a.kind as keyof typeof notifications]
    avisos[`${a.kind}__email`] = canais?.email ? 'on' : ''
    avisos[`${a.kind}__push`] = canais?.push ? 'on' : ''
  }
  return (
    <>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Regras de agenda e fuso</h2>
        <RegrasForm
          action={salvarRegras.bind(null, conta.id)}
          fusos={fusos}
          grades={SLOT_STEPS}
          limites={RULE_LIMITS}
          valores={{
            slotStepMin: String(rules.slotStepMin),
            minLeadMin: String(rules.minLeadMin),
            maxAdvanceDays: String(rules.maxAdvanceDays),
            customerChangeWindowMin: String(rules.customerChangeWindowMin),
            bufferMin: String(rules.bufferMin),
            autoConfirm: rules.autoConfirm ? 'on' : '',
            timeZone,
          }}
        />
      </Card>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Avisos por tipo e canal</h2>
        <p className="af-section__help">Desmarcar um canal para de mandar aquele aviso por ele nesta conta.</p>
        <AvisosForm action={salvarAvisos.bind(null, conta.id)} valores={avisos} avisos={lista} />
      </Card>
    </>
  )
}
