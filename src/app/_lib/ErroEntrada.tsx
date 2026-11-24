'use client'

import { useEffect } from 'react'
import { Button, LinkButton } from '@/ui/components'
import { EntryScreen } from '@/ui/shells'

const MARCA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, loginImageUrl: null, platform: true }

/**
 * Tela de erro da marca (fora do painel): o mesmo texto para qualquer falha, sem a mensagem do erro. Só o código curto
 * (`digest`) vai para o console, para achar a linha no registro do servidor.
 */
export function ErroEntrada({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('erro de tela', error.digest ?? 'sem código')
  }, [error.digest])
  return (
    <EntryScreen
      brand={MARCA}
      headline="A agenda que flui."
      title="Não deu para abrir esta tela"
      message="Tente de novo. Se continuar, volte ao início e abra de novo."
      testId="erro-entrada"
    >
      <div className="af-entry__form" role="alert">
        <Button variant="primary" size="lg" onClick={reset}>
          Tentar de novo
        </Button>
        <LinkButton href="/" variant="ghost" size="lg">
          Ir para o início
        </LinkButton>
      </div>
    </EntryScreen>
  )
}
