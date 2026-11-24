'use client'
import { useState } from 'react'
import { CalendarCheck, CalendarX2 } from 'lucide-react'
import { ChoiceCard, WeekScheduleEditor, weekFromFields } from '@/ui/components'
import type { WeekValue } from '@/ui/components'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { salvarExpediente } from '../actions'

/** O expediente que a tela sugere: segunda a sexta, 09:00 às 18:00; sábado, 09:00 às 13:00. */
export const EXPEDIENTE_PADRAO: WeekValue = {
  MONDAY: [{ start: '09:00', end: '18:00' }],
  TUESDAY: [{ start: '09:00', end: '18:00' }],
  WEDNESDAY: [{ start: '09:00', end: '18:00' }],
  THURSDAY: [{ start: '09:00', end: '18:00' }],
  FRIDAY: [{ start: '09:00', end: '18:00' }],
  SATURDAY: [{ start: '09:00', end: '13:00' }],
}

/** Passo 5: "Você também atende?". Sim abre o expediente da semana; Não segue sem criar ficha. */
export function PassoExpediente() {
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  return (
    <PainelForm action={salvarExpediente} initial={inicial} submit="Salvar e continuar" anchors={{}}>
      {(state) => <Campos valores={state.values} erros={state.fields} />}
    </PainelForm>
  )
}

function Campos({ valores, erros }: { valores: Record<string, string>; erros: Record<string, string> }) {
  const [atende, setAtende] = useState(valores.attends === 'nao' ? 'nao' : 'sim')
  const semana = Object.keys(valores).some((k) => /^[A-Z]+\.\d+\./.test(k)) ? weekFromFields(valores) : EXPEDIENTE_PADRAO
  return (
    <>
      <fieldset className="af-onb__choices">
        <legend className="af-field__label">Você também atende?</legend>
        <div className="af-onb__choicegrid">
          <ChoiceCard type="radio" name="attends" value="sim" checked={atende === 'sim'} onChange={setAtende} title="Sim, também atendo" detail="Crio a sua ficha de profissional." media={<CalendarCheck size={22} />} />
          <ChoiceCard type="radio" name="attends" value="nao" checked={atende === 'nao'} onChange={setAtende} title="Não, só cuido da loja" detail="Os profissionais entram no próximo passo." media={<CalendarX2 size={22} />} />
        </div>
      </fieldset>
      {atende === 'sim' ? (
        <div className="af-onb__week">
          <p className="af-field__hint">Ajuste os horários em que você atende. Dia sem faixa fica fechado.</p>
          <WeekScheduleEditor defaultValue={semana} errors={erros} />
        </div>
      ) : (
        <p className="af-onb__lead">Tudo bem. Você pode criar a sua ficha depois, em Profissionais.</p>
      )}
    </>
  )
}
