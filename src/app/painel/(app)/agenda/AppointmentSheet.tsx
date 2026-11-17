'use client'
import { useState } from 'react'
import { Ban, BellRing, CalendarClock, Check, CircleCheck, Undo2, UserX } from 'lucide-react'
import type { AgendaPage, PageDetail } from '@/server/domain/scheduling/agenda-page'
import { AppointmentStatusBadge, Button, Checkbox, Dialog, Field, MoneyField, PhoneLink, Sheet, Textarea } from '@/ui/components'
import { formatDuration, formatLocalDate, formatMoney } from '@/ui/format'
import { formatMoneyInput } from '@/ui/money'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { ajustarAtendimento, avisarLivre, mudarSituacao } from './actions'

type Decisao = 'complete' | 'noshow' | 'cancel'

const DECISOES: Record<Decisao, { titulo: (nome: string) => string; verbo: string; texto: string }> = {
  complete: { titulo: (n) => `Concluir o atendimento de ${n}?`, verbo: 'Concluir atendimento', texto: 'O atendimento passa a contar como feito e a comissão é registrada.' },
  noshow: { titulo: (n) => `Marcar falta de ${n}?`, verbo: 'Marcar falta', texto: 'O horário fica sem atendimento. Você pode desfazer depois, se foi engano.' },
  cancel: { titulo: (n) => `Cancelar o atendimento de ${n}?`, verbo: 'Cancelar atendimento', texto: 'O horário volta a ficar livre e o cliente é avisado.' },
}

/** Confirmação de concluir, faltou e cancelar: o botão repete o verbo do título. Cancelar leva o motivo. */
function DecisaoDialog({ detalhe, decisao, onClose, onDone }: { detalhe: PageDetail; decisao: Decisao | null; onClose: () => void; onDone: () => void }) {
  const d = decisao ? DECISOES[decisao] : null
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  return (
    <Dialog open={decisao !== null} onClose={onClose} title={d ? d.titulo(detalhe.customer.name) : ''}>
      {d && decisao ? (
        <PainelForm action={mudarSituacao} initial={inicial} submit={d.verbo} onDone={onDone} secondary={<Button variant="ghost" onClick={onClose}>Voltar</Button>}>
          {(state) => (
            <>
              <input type="hidden" name="id" value={detalhe.id} />
              <input type="hidden" name="to" value={decisao} />
              <p className="af-confirm__text">{d.texto}</p>
              {decisao === 'cancel' ? (
                <Field label="Motivo" hint="Opcional. Fica no histórico do atendimento." error={state.fields.reason}>
                  <Textarea name="reason" rows={2} maxLength={300} />
                </Field>
              ) : null}
            </>
          )}
        </PainelForm>
      ) : null}
    </Dialog>
  )
}

function Ajustes({ detalhe, page, onDone }: { detalhe: PageDetail; page: AgendaPage; onDone: () => void }) {
  const marcados = detalhe.items.map((i) => i.serviceId)
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { price: formatMoneyInput(detalhe.totalCents), notes: detalhe.notes ?? '' } }
  return (
    <details className="af-slipdetail__adjust">
      <summary>Ajustar serviços, valor e observação</summary>
      <PainelForm action={ajustarAtendimento} initial={inicial} submit="Salvar ajustes" onDone={onDone} labels={{ price: 'Valor', notes: 'Observação', serviceIds: 'Serviços' }}>
        {(state) => (
          <>
            <input type="hidden" name="id" value={detalhe.id} />
            <fieldset className="af-pick">
              <legend className="af-field__label">Serviços</legend>
              {page.services.map((s) => (
                <Checkbox key={s.id} name="serviceIds" value={s.id} defaultChecked={marcados.includes(s.id)} label={`${s.name} · ${formatDuration(s.durationMin)} · ${formatMoney(s.priceCents)}`} />
              ))}
            </fieldset>
            {page.scope === 'all' ? (
              <Field label="Valor (R$)" hint="Trocar os serviços recalcula o valor; digite aqui para combinar outro." error={state.fields.price}>
                <MoneyField name="price" defaultValue={state.values.price ?? ''} />
              </Field>
            ) : null}
            <Field label="Observação" hint="Anotação da equipe." error={state.fields.notes}>
              <Textarea name="notes" rows={2} maxLength={2000} defaultValue={state.values.notes ?? ''} />
            </Field>
          </>
        )}
      </PainelForm>
    </details>
  )
}

/** A ficha do atendimento: quem, quando, o que, e o que dá para fazer com ele agora. */
export function AppointmentSheet({ detalhe, page, onClose, onReschedule }: { detalhe: PageDetail | null; page: AgendaPage; onClose: () => void; onReschedule?: (id: string) => void }) {
  const [decisao, setDecisao] = useState<Decisao | null>(null)
  const d = detalhe
  const emAberto = d !== null && (d.status === 'PENDING' || d.status === 'CONFIRMED')
  const fechar = () => {
    setDecisao(null)
    onClose()
  }
  return (
    <>
      <Sheet open={d !== null} onClose={fechar} title={d ? d.customer.name : 'Atendimento'}>
        {d ? (
          <div className="af-slipdetail">
            <div className="af-slipdetail__head">
              <AppointmentStatusBadge status={d.status} />
              <p className="af-slipdetail__when">
                <time dateTime={d.date}>{formatLocalDate(d.date)}</time>, {d.startLabel} às {d.endLabel}
              </p>
            </div>
            <dl className="af-slipdetail__facts">
              <div>
                <dt>Telefone</dt>
                <dd>
                  <PhoneLink phone={d.customer.phoneLabel} />
                </dd>
              </div>
              <div>
                <dt>Profissional</dt>
                <dd>{d.professional.name}</dd>
              </div>
              <div>
                <dt>Serviços</dt>
                <dd>
                  <ul className="af-slipdetail__items">
                    {d.items.map((i) => (
                      <li key={i.serviceId}>
                        {i.name} · {formatDuration(i.durationMin)} · {formatMoney(i.priceCents)}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className="af-tabular">
                  {formatMoney(d.totalCents)} · {formatDuration(d.totalDurationMin)}
                </dd>
              </div>
              {d.customerNote ? (
                <div>
                  <dt>Pedido do cliente</dt>
                  <dd>{d.customerNote}</dd>
                </div>
              ) : null}
              {d.notes ? (
                <div>
                  <dt>Anotação da equipe</dt>
                  <dd>{d.notes}</dd>
                </div>
              ) : null}
            </dl>

            <div className="af-slipdetail__actions">
              {d.status === 'PENDING' ? (
                <AcaoDeLinha action={mudarSituacao} campos={{ id: d.id, to: 'confirm' }} variant="primary" size="md" icon={<Check size={18} />} showOk>
                  Confirmar atendimento
                </AcaoDeLinha>
              ) : null}
              {d.status === 'CONFIRMED' ? (
                <>
                  <Button variant="primary" icon={<CircleCheck size={18} />} onClick={() => setDecisao('complete')}>
                    Concluir atendimento
                  </Button>
                  <Button variant="secondary" icon={<UserX size={18} />} onClick={() => setDecisao('noshow')}>
                    Marcar falta
                  </Button>
                </>
              ) : null}
              {d.canFreeEarly ? (
                <AcaoDeLinha action={avisarLivre} campos={{ id: d.id }} variant="secondary" size="md" icon={<BellRing size={18} />} showOk>
                  Já estou livre
                </AcaoDeLinha>
              ) : null}
              {d.status === 'COMPLETED' || d.status === 'NO_SHOW' ? (
                <AcaoDeLinha action={mudarSituacao} campos={{ id: d.id, to: 'undo' }} variant="secondary" size="md" icon={<Undo2 size={18} />} showOk>
                  Desfazer {d.status === 'COMPLETED' ? 'conclusão' : 'falta'}
                </AcaoDeLinha>
              ) : null}
              {emAberto && onReschedule ? (
                <Button variant="secondary" icon={<CalendarClock size={18} />} onClick={() => onReschedule(d.id)}>
                  Remarcar
                </Button>
              ) : null}
              {emAberto ? (
                <Button variant="ghost" icon={<Ban size={18} />} onClick={() => setDecisao('cancel')}>
                  Cancelar atendimento
                </Button>
              ) : null}
            </div>

            {emAberto ? <Ajustes key={`${d.id}-${d.totalCents}-${d.items.length}`} detalhe={d} page={page} onDone={() => undefined} /> : null}
          </div>
        ) : null}
      </Sheet>
      {d ? <DecisaoDialog detalhe={d} decisao={decisao} onClose={() => setDecisao(null)} onDone={fechar} /> : null}
    </>
  )
}
