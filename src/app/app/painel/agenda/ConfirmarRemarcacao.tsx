'use client'
import { useEffect, useState } from 'react'
import { rotuloDoHorario } from '@/app/_lib/form-state'
import type { PageDetail } from '@/server/domain/scheduling/agenda-page'
import { Button, Dialog } from '@/ui/components'
import { ConflitosAviso } from './ConflitosDialog'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { remarcarAtendimento } from './actions'
import { horarioEfetivo } from './consultas'

export type AlvoRemarcar = { id: string; professionalId: string; professionalName: string; date: string; startLabel: string }

function Formulario({ alvo, detalhe, onClose }: { alvo: AlvoRemarcar; detalhe: PageDetail; onClose: () => void }) {
  const [usar, setUsar] = useState<{ iso: string; label: string; date: string } | null>(null)
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  const [efetivo, setEfetivo] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void horarioEfetivo(alvo.date, alvo.startLabel).then((l) => {
      if (vivo) setEfetivo(l)
    })
    return () => {
      vivo = false
    }
  }, [alvo.date, alvo.startLabel])
  // O que vai ser gravado: o horário oferecido, ou o digitado já convertido pelo servidor (hora que não existe avança).
  const label = usar ? rotuloDoHorario(usar, alvo.date) : (efetivo ?? alvo.startLabel)
  const avancou = !usar && efetivo !== null && efetivo !== alvo.startLabel
  return (
    <PainelForm action={remarcarAtendimento} initial={inicial} submit={(state) => (state.confirmation ? 'Remarcar mesmo assim' : 'Remarcar atendimento')} onDone={onClose} secondary={<Button variant="ghost" onClick={onClose}>Voltar</Button>}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={alvo.id} />
          <input type="hidden" name="fromStartsAt" value={detalhe.startsAtIso} />
          <input type="hidden" name="fromProfessionalId" value={detalhe.professional.id} />
          <input type="hidden" name="professionalId" value={alvo.professionalId} />
          <input type="hidden" name="date" value={usar && usar.date !== '' ? usar.date : alvo.date} />
          <input type="hidden" name="time" value={usar ? '' : alvo.startLabel} />
          <input type="hidden" name="startsAt" value={usar?.iso ?? ''} />
          <p className="af-confirm__text">
            {detalhe.customer.name} passa de {detalhe.startLabel} com {detalhe.professional.name} para {label} com {alvo.professionalName}. O cliente é avisado da mudança.
          </p>
          <ConflitosAviso confirmation={state.confirmation} />
          {avancou ? <p className="af-planner__warn">O horário {alvo.startLabel} não existe neste dia (troca do horário de verão). O atendimento fica às {efetivo}.</p> : null}
          {state.conflict && state.conflict.nearest.length > 0 ? (
            <div className="af-pick" role="group" aria-label="Horários livres mais próximos">
              <p className="af-section__help">O horário não deu certo. A ficha continua onde estava. Horários livres mais próximos:</p>
              <div className="af-pick__times">
                {state.conflict.nearest.map((n) => (
                  <Button key={n.iso} size="sm" variant="secondary" onClick={() => setUsar(n)}>
                    Usar {rotuloDoHorario(n, alvo.date)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </PainelForm>
  )
}

/** Confirmação curta ao soltar a ficha: "Remarcar Marina?", com o horário que vale no texto. Só grava depois do botão. */
export function ConfirmarRemarcacao({ alvo, detalhe, onClose }: { alvo: AlvoRemarcar | null; detalhe: PageDetail | null; onClose: () => void }) {
  const aberto = alvo !== null && detalhe !== null
  return (
    <Dialog open={aberto} onClose={onClose} title={alvo && detalhe ? `Remarcar ${detalhe.customer.name}?` : ''}>
      {alvo && detalhe ? <Formulario key={`${alvo.id}-${alvo.professionalId}-${alvo.startLabel}`} alvo={alvo} detalhe={detalhe} onClose={onClose} /> : null}
    </Dialog>
  )
}
