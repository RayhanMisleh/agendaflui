'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@/ui/components'

/** Erro inesperado numa tela da loja: diz o que fazer, sem detalhe técnico. */
export default function LojaError({ error, retry }: { error: unknown; retry: () => void }) {
  const { slug } = useParams<{ slug: string }>()
  useEffect(() => {
    console.error(JSON.stringify({ level: 'error', event: 'loja_page_failed', error: error instanceof Error ? error.name : 'unknown' }))
  }, [error])
  return (
    <main className="af-cl-state" role="alert">
      <h1 className="af-cl-state__title">Não deu para abrir esta página.</h1>
      <p className="af-cl-state__text">Tente de novo. Se continuar, volte ao início e fale com a loja.</p>
      <div className="af-cl-state__actions">
        <Button variant="primary" size="lg" onClick={() => retry()}>
          Tentar de novo
        </Button>
        <Link href={`/${slug}`} className="af-button af-button--secondary af-button--lg">
          <span className="af-button__label">Ir para o início</span>
        </Link>
      </div>
    </main>
  )
}
