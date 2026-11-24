'use client'
import { useEffect, useState } from 'react'
import { Ban, CalendarClock, Clock, DoorClosed } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Confirmacao } from '@/app/_lib/form-state'
import { Button, Dialog } from '@/ui/components'

const ICONES = { closed: DoorClosed, outside_hours: Clock, blocked: Ban, busy: CalendarClock } as const

/** A lista do que há no horário, com ícone e o texto do servidor; com conflito de agendamento, avisa que vira encaixe. */
export function ListaDeConflitos({ confirmation, notice }: { confirmation: Confirmacao; notice?: boolean }) {
  const temBusy = confirmation.issues.some((i) => i.kind === 'busy')
  return (
    <div className={notice ? 'af-issues af-issues--notice' : undefined}>
      <ul className="af-issues" aria-label="O que há neste horário">
        {confirmation.issues.map((i) => {
          const Icone = ICONES[i.kind]
          return (
            <li key={`${i.kind}-${i.text}`} className="af-issues__item">
              <Icone size={18} aria-hidden="true" />
              <span>{i.text}</span>
            </li>
          )
        })}
      </ul>
      {temBusy ? <p className="af-issues__note">Vai ficar como encaixe se sobrepor outro atendimento.</p> : null}
    </div>
  )
}

/**
 * Diálogo "Confirme o horário": abre a cada impressão (`ack`) nova que o servidor devolve. O botão envia o formulário
 * indicado (`formId`) com `ack`; "Voltar" fecha sem limpar o que a pessoa preencheu.
 */
export function ConflitosDialog({ formId, confirmation, confirmLabel, onBack }: { formId: string; confirmation: Confirmacao | undefined; confirmLabel: string; onBack?: () => void }): ReactNode {
  const [fechado, setFechado] = useState<string | null>(null)
  const ack = confirmation?.ack ?? null
  // Uma impressão nova (o servidor pediu de novo) reabre o diálogo mesmo que a anterior tenha sido fechada.
  useEffect(() => {
    setFechado((atual) => (atual !== ack ? null : atual))
  }, [ack])
  const aberto = confirmation !== undefined && ack !== fechado
  const voltar = () => {
    setFechado(ack)
    onBack?.()
  }
  return (
    <Dialog
      open={aberto}
      onClose={voltar}
      title="Confirme o horário"
      footer={
        <>
          <Button variant="ghost" onClick={voltar}>
            Voltar
          </Button>
          <Button type="submit" variant="primary" form={formId} name="ack" value={confirmation?.ack ?? ''} onClick={() => setFechado(ack)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmation ? <ListaDeConflitos confirmation={confirmation} /> : null}
    </Dialog>
  )
}

/** O mesmo conteúdo como aviso dentro de um formulário que já é diálogo (remarcar por arrasto): o `ack` vai escondido. */
export function ConflitosAviso({ confirmation }: { confirmation: Confirmacao | undefined }): ReactNode {
  if (!confirmation) return null
  return (
    <div role="alert">
      <p className="af-confirm__text">Confira o horário antes de remarcar:</p>
      <ListaDeConflitos confirmation={confirmation} notice />
      <input type="hidden" name="ack" value={confirmation.ack} />
    </div>
  )
}
