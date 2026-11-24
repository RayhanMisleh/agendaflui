'use client'
import { useActionState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/ui/components'
import { usarMinhaConta, type EstadoLoja } from '../actions'

const INICIAL: EstadoLoja = { error: null }

/** A pessoa tem sessão mas ainda não é cliente: escolher usar a conta aqui é o que a torna cliente da loja. */
export function UsarMinhaConta({ slug, volta = null }: { slug: string; volta?: string | null }) {
  const [state, formAction, pending] = useActionState(usarMinhaConta, INICIAL)
  return (
    <form action={formAction} className="af-entry__actions">
      <input type="hidden" name="slug" value={slug} />
      {volta ? <input type="hidden" name="volta" value={volta} /> : null}
      <p className="af-entry__message">A loja vai ver seu nome, e-mail e telefone.</p>
      {state.error ? (
        <p role="alert" className="af-entry__error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Usar minha conta nesta loja
      </Button>
    </form>
  )
}
