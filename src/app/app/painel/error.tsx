'use client'

import { useEffect } from 'react'
import { Button, Card, EmptyState, LinkButton } from '@/ui/components'

/** Falha numa tela do painel: texto fixo (nunca a mensagem do erro) e duas saídas. O tema da conta vem do layout. */
export default function ErroDoPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('erro de tela do painel', error.digest ?? 'sem código')
  }, [error.digest])
  return (
    <main className="af-fallback">
      <Card as="section" className="af-fallback__card">
        <div role="alert">
          <EmptyState
            title="Não deu para abrir esta tela"
            description="Tente de novo. Se continuar, volte ao início e abra de novo."
            action={
              <span className="af-fallback__actions">
                <Button variant="primary" onClick={reset}>
                  Tentar de novo
                </Button>
                <LinkButton href="/painel" variant="ghost">
                  Voltar ao início
                </LinkButton>
              </span>
            }
          />
        </div>
      </Card>
    </main>
  )
}
