'use client'
import type { AgendaPage } from '@/server/domain/scheduling/agenda-page'
import { Field, Input, Select, Sheet } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { bloquearHorario } from '../equipe/actions'

const ROTULOS = { startDate: 'Data de início', startTime: 'Hora de início', endDate: 'Data do fim', endTime: 'Hora do fim', reason: 'Motivo' }

function Formulario({ page, professionalSingular, onDone }: { page: AgendaPage; professionalSingular: string; onDone: () => void }) {
  const dono = page.scope === 'own' ? (page.ownProfessionalId ?? '') : page.filter !== 'todos' ? page.filter : (page.professionals[0]?.id ?? '')
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { id: dono, startDate: page.date, startTime: '12:00', endDate: page.date, endTime: '13:00' } }
  return (
    <PainelForm action={bloquearHorario} initial={inicial} submit={(s) => (s.values.affected && !s.ok ? 'Bloquear mesmo assim' : 'Bloquear horário')} onDone={onDone} labels={ROTULOS}>
      {(state) => {
        const v = state.values
        const atinge = !state.ok && v.affected && v.confirm
        return (
          <>
            {page.scope === 'all' ? (
              <Field label={professionalSingular}>
                <Select name="id" defaultValue={v.id ?? dono}>
                  {page.professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="id" value={dono} />
            )}
            {atinge ? <input type="hidden" name="confirm" value={v.confirm} /> : null}
            <div className="af-formgrid">
              <Field label="Início" error={state.fields.startDate}>
                <Input type="date" name="startDate" defaultValue={v.startDate ?? ''} required />
              </Field>
              <Field label="Hora do início" error={state.fields.startTime}>
                <Input type="time" name="startTime" step={300} defaultValue={v.startTime ?? ''} required />
              </Field>
              <Field label="Fim" error={state.fields.endDate}>
                <Input type="date" name="endDate" defaultValue={v.endDate ?? ''} required />
              </Field>
              <Field label="Hora do fim" error={state.fields.endTime}>
                <Input type="time" name="endTime" step={300} defaultValue={v.endTime ?? ''} required />
              </Field>
            </div>
            <Field label="Motivo" hint="Opcional. Só a equipe vê." error={state.fields.reason}>
              <Input name="reason" defaultValue={v.reason ?? ''} maxLength={200} autoComplete="off" />
            </Field>
          </>
        )
      }}
    </PainelForm>
  )
}

/** Bloquear horário: folga ou compromisso. Se cobrir atendimentos, avisa quantos e pede a confirmação. */
export function BlockSheet({ open, onClose, page, professionalSingular }: { open: boolean; onClose: () => void; page: AgendaPage; professionalSingular: string }) {
  return (
    <Sheet open={open} onClose={onClose} title="Bloquear horário">
      <Formulario page={page} professionalSingular={professionalSingular} onDone={onClose} />
    </Sheet>
  )
}
