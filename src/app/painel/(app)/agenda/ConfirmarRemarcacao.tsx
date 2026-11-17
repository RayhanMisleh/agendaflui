'use client'
import { useState } from 'react'
import type { PageDetail } from '@/server/domain/scheduling/agenda-page'
import { Button, Dialog } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { remarcarAtendimento } from './actions'

export type AlvoRemarcar = { id: string; professionalId: string; professionalName: string; date: string; startLabel: string }

function Formulario({ alvo, detalhe, onClose }: { alvo: AlvoRemarcar; detalhe: PageDetail; onClose: () => void }) {
  const [usar, setUsar] = useState<{ iso: string; label: string } | null>(null)
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  const label = usar?.label ?? alvo.startLabel
  return (
    <PainelForm action={remarcarAtendimento} initial={inicial} submit="Remarcar atendimento" onDone={onClose} secondary={<Button variant="ghost" onClick={onClose}>Voltar</Button>}>
      {(state) => (
        <>
          <input type="hidden" name="id" value={alvo.id} />
          <input type="hidden" name="professionalId" value={alvo.professionalId} />
          <input type="hidden" name="date" value={alvo.date} />
          <input type="hidden" name="time" value={usar ? '' : alvo.startLabel} />
          <input type="hidden" name="startsAt" value={usar?.iso ?? ''} />
          <p className="af-confirm__text">
            {detalhe.customer.name} passa de {detalhe.startLabel} com {detalhe.professional.name} para {label} com {alvo.professionalName}. O cliente é avisado da mudança.
          </p>
          {state.conflict && state.conflict.nearest.length > 0 ? (
            <div className="af-pick" role="group" aria-label="Horários livres mais próximos">
              <p className="af-section__help">O horário não deu certo. A ficha continua onde estava. Horários livres mais próximos:</p>
              <div className="af-pick__times">
                {state.conflict.nearest.map((n) => (
                  <Button key={n.iso} size="sm" variant="secondary" onClick={() => setUsar(n)}>
                    Usar {n.label}
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

/** Confirmação curta ao soltar a ficha: "Remarcar Marina para 15:30 com Ana?". Só grava depois do botão. */
export function ConfirmarRemarcacao({ alvo, detalhe, onClose }: { alvo: AlvoRemarcar | null; detalhe: PageDetail | null; onClose: () => void }) {
  const aberto = alvo !== null && detalhe !== null
  return (
    <Dialog open={aberto} onClose={onClose} title={alvo && detalhe ? `Remarcar ${detalhe.customer.name} para ${alvo.startLabel} com ${alvo.professionalName}?` : ''}>
      {alvo && detalhe ? <Formulario key={`${alvo.id}-${alvo.professionalId}-${alvo.startLabel}`} alvo={alvo} detalhe={detalhe} onClose={onClose} /> : null}
    </Dialog>
  )
}
