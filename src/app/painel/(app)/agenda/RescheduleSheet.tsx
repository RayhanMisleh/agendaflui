'use client'
import { useState } from 'react'
import type { AgendaPage, PageDetail } from '@/server/domain/scheduling/agenda-page'
import { Field, Select, Sheet } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { remarcarAtendimento } from './actions'
import { HorarioFields } from './HorarioFields'

function Formulario({ detalhe, page, professionalSingular, onDone }: { detalhe: PageDetail; page: AgendaPage; professionalSingular: string; onDone: () => void }) {
  const [profissional, setProfissional] = useState(detalhe.professional.id)
  const [dia, setDia] = useState(detalhe.date)
  const [hora, setHora] = useState('')
  const [escolhido, setEscolhido] = useState('')
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  return (
    <PainelForm action={remarcarAtendimento} initial={inicial} submit="Remarcar atendimento" onDone={onDone} labels={{ date: 'Dia', time: 'Horário', professionalId: professionalSingular }}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={detalhe.id} />
          <input type="hidden" name="fromStartsAt" value={detalhe.startsAtIso} />
          <input type="hidden" name="fromProfessionalId" value={detalhe.professional.id} />
          <p className="af-section__help">
            Agora: {detalhe.startLabel} com {detalhe.professional.name}.
          </p>
          {page.scope === 'all' ? (
            <Field label={professionalSingular} error={state.fields.professionalId}>
              <Select name="professionalId" value={profissional} onChange={(e) => setProfissional(e.target.value)}>
                {page.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="professionalId" value={detalhe.professional.id} />
          )}
          <HorarioFields
            serviceIds={detalhe.items.map((i) => i.serviceId)}
            professionalId={profissional}
            date={dia}
            onDate={setDia}
            time={hora}
            onTime={setHora}
            chosen={escolhido}
            onChosen={setEscolhido}
            prefillTime=""
            conflict={state.conflict}
            errors={{ date: state.fields.date, time: state.fields.time }}
            idPrefix="remarcar"
          />
        </>
      )}
    </PainelForm>
  )
}

/** Remarcar sem arrastar: dia e horário pela disponibilidade do servidor. É o caminho completo, no celular e no teclado. */
export function RescheduleSheet({ detalhe, page, professionalSingular, onClose }: { detalhe: PageDetail | null; page: AgendaPage; professionalSingular: string; onClose: () => void }) {
  return (
    <Sheet open={detalhe !== null} onClose={onClose} title={detalhe ? `Remarcar ${detalhe.customer.name}` : 'Remarcar'}>
      {detalhe ? <Formulario key={detalhe.id} detalhe={detalhe} page={page} professionalSingular={professionalSingular} onDone={onClose} /> : null}
    </Sheet>
  )
}
