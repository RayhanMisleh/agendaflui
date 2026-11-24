'use client'
import { useActionState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { Button, FormErrors, Textarea } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { ESTADO_VAZIO, type EstadoCliente } from '../../_lib/estado'
import { Passo } from './Passo'

export type ResumoDoAgendamento = {
  pet: string | null
  servicos: { name: string; priceCents: number }[]
  totalCents: number | null
  profissional: string
  quando: string
}

/** Tudo certo? O resumo do que vai ser marcado, o recado para a loja e o botão que grava (ou remarca). */
export function PassoConfirmar({
  action,
  hidden,
  repetidos,
  resumo,
  note,
  onNote,
  remarcar,
}: {
  action: (prev: EstadoCliente, form: FormData) => Promise<EstadoCliente>
  hidden: Record<string, string>
  repetidos: { name: string; values: string[] }
  resumo: ResumoDoAgendamento
  note: string
  onNote: (t: string) => void
  remarcar: boolean
}) {
  const [state, formAction, pending] = useActionState(action, ESTADO_VAZIO)
  return (
    <Passo id="confirmar" title={remarcar ? 'Confirmar remarcação' : 'Tudo certo?'}>
      <form action={formAction} className="af-cl-form" noValidate>
        {Object.entries(hidden).map(([nome, valor]) => (
          <input key={nome} type="hidden" name={nome} value={valor} />
        ))}
        {repetidos.values.map((v) => (
          <input key={v} type="hidden" name={repetidos.name} value={v} />
        ))}
        <dl className="af-cl-quiz__summary">
          {resumo.pet ? (
            <div className="af-cl-quiz__row">
              <dt>Pet</dt>
              <dd>{resumo.pet}</dd>
            </div>
          ) : null}
          {resumo.servicos.length > 0 ? (
            <div className="af-cl-quiz__row">
              <dt>Serviços</dt>
              <dd>
                {resumo.servicos.map((s) => (
                  <span key={s.name} className="af-cl-flow__line">
                    <span>{s.name}</span>
                    <span className="af-tabular">{formatMoney(s.priceCents)}</span>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          <div className="af-cl-quiz__row">
            <dt>Com</dt>
            <dd>{resumo.profissional}</dd>
          </div>
          <div className="af-cl-quiz__row">
            <dt>Quando</dt>
            <dd>{resumo.quando}</dd>
          </div>
          {resumo.totalCents !== null ? (
            <div className="af-cl-quiz__row">
              <dt>Total</dt>
              <dd className="af-tabular">
                <strong>{formatMoney(resumo.totalCents)}</strong>
              </dd>
            </div>
          ) : null}
        </dl>
        {remarcar ? null : (
          <div className="af-field">
            <label htmlFor="recado" className="af-field__label">
              Recado para a loja
            </label>
            <Textarea id="recado" name="customerNote" rows={3} maxLength={500} value={note} onChange={(e) => onNote(e.target.value)} placeholder="Opcional" />
          </div>
        )}
        {state.ok ? null : <FormErrors message={state.message} fields={state.fields} />}
        <Button type="submit" variant="primary" size="lg" loading={pending} icon={<CalendarCheck size={18} />}>
          {remarcar ? 'Remarcar para este horário' : 'Confirmar horário'}
        </Button>
      </form>
    </Passo>
  )
}
