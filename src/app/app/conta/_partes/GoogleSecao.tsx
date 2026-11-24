'use client'
import { useState } from 'react'
import { Button, Card, ConfirmDialog, GoogleButton, LinkButton, StatusBadge, useToast } from '@/ui/components'
import { desvincularGoogle } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import type { EstadoConta } from '../_lib/estado'

const SEM_SENHA = 'Crie uma senha antes de desvincular, para não perder o acesso.'

/** "Google": vinculado (com desvincular, que confirma) ou não vinculado (com o botão de vincular). */
export function GoogleSecao({
  google,
  hasPassword,
  email,
  aviso,
}: {
  google: { email: string } | null
  hasPassword: boolean
  email: string
  /** O resultado do último retorno do Google (`?google=`), já como componente. */
  aviso?: React.ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  const toast = useToast()
  const desvincular = async (anterior: EstadoConta): Promise<EstadoConta> => {
    const r = await desvincularGoogle(anterior)
    if (r.ok && r.message) toast({ tone: 'success', message: r.message })
    return r
  }
  return (
    <Card as="section" aria-labelledby="conta-google" className="af-conta__card">
      <div className="af-conta__head">
        <h2 id="conta-google" className="af-section__title">
          Google
        </h2>
        <StatusBadge tone={google ? 'confirmed' : 'neutral'}>{google ? 'Vinculado' : 'Não vinculado'}</StatusBadge>
      </div>
      {aviso}
      {google ? (
        <>
          <p className="af-conta__value">Vinculado a {google.email}</p>
          {hasPassword ? (
            <>
              <div className="af-conta__actions">
                <Button variant="secondary" onClick={() => setAberto(true)}>
                  Desvincular
                </Button>
              </div>
              <ConfirmDialog
                open={aberto}
                onClose={() => setAberto(false)}
                title="Desvincular o Google?"
                description="Você deixa de entrar com o Google e continua entrando com e-mail e senha."
                action={desvincular}
                initialState={ESTADO_CONTA}
                confirmLabel="Desvincular"
              />
            </>
          ) : (
            <>
              <p className="af-conta__note">{SEM_SENHA}</p>
              <div className="af-conta__actions">
                <LinkButton href="#senha" variant="secondary">
                  Criar senha
                </LinkButton>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="af-conta__muted">Entre com um toque. Use a conta Google com o e-mail {email}.</p>
          <GoogleButton enabled fluxo="vincular" label="Vincular conta Google" />
        </>
      )}
    </Card>
  )
}
