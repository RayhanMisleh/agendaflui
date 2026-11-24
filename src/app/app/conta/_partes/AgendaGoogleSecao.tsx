'use client'
import { useState } from 'react'
import { Button, Card, ConfirmDialog, GoogleButton, StatusDot } from '@/ui/components'
import { desligarAgenda } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'

type Props = {
  state: 'off' | 'on' | 'revoked'
  /** Google configurado na plataforma e vinculado à conta da pessoa: sem isso não dá para ligar. */
  available: boolean
  hasGoogle: boolean
  /** "Atualizada em ..." no fuso da loja; `null` enquanto nada foi enviado. */
  syncedLabel: string | null
  /** O resultado do último retorno do Google (`?google=`), já como componente. */
  aviso?: React.ReactNode
}

/** "Google Agenda": os atendimentos da pessoa na agenda principal do Google dela (só enviar). Ligada, desligada ou recusada pelo Google. */
export function AgendaGoogleSecao({ state, available, hasGoogle, syncedLabel, aviso }: Props) {
  const [aberto, setAberto] = useState(false)
  const ligar = (label: string) => (available ? <GoogleButton enabled fluxo="agenda" label={label} /> : null)
  return (
    <Card as="section" id="agenda" aria-labelledby="conta-agenda" className="af-conta__card">
      <div className="af-conta__head">
        <h2 id="conta-agenda" className="af-section__title">
          Google Agenda
        </h2>
        {state === 'on' ? <StatusDot tone="success" label="Ligada" /> : null}
        {state === 'revoked' ? <StatusDot tone="danger" label="Desligada — ligue de novo" /> : null}
      </div>
      {aviso}
      {state === 'on' ? (
        <>
          <p className="af-conta__muted">{syncedLabel ? `Atualizada em ${syncedLabel}.` : 'Enviando seus atendimentos…'}</p>
          <p className="af-conta__muted">Remarcações e cancelamentos acompanham a sua agenda do Google.</p>
          <div className="af-conta__actions">
            <Button variant="secondary" onClick={() => setAberto(true)}>
              Desligar
            </Button>
          </div>
          <ConfirmDialog
            open={aberto}
            onClose={() => setAberto(false)}
            title="Desligar a agenda?"
            description="Os eventos já enviados ficam na sua agenda do Google."
            action={desligarAgenda}
            initialState={ESTADO_CONTA}
            confirmLabel="Desligar"
          />
        </>
      ) : state === 'revoked' ? (
        <>
          <p className="af-conta__muted">O Google recusou o acesso. Ligue de novo para voltar a enviar.</p>
          {ligar('Ligar de novo')}
        </>
      ) : (
        <>
          <p className="af-conta__muted">Seus atendimentos aparecem na agenda principal do seu Google e acompanham remarcações e cancelamentos.</p>
          {!hasGoogle ? (
            <p className="af-conta__muted">Vincule o Google acima para ligar a agenda.</p>
          ) : !available ? (
            <p className="af-conta__muted">A agenda do Google não está disponível agora.</p>
          ) : (
            ligar('Ligar Google Agenda')
          )}
        </>
      )}
    </Card>
  )
}
