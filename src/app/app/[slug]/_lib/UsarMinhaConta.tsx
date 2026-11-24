'use client'
import { useActionState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/ui/components'
import { usarMinhaConta, type EstadoLoja } from '../actions'

const INICIAL: EstadoLoja = { error: null }

/**
 * A pessoa tem sessão mas ainda não é cliente: escolher usar a conta aqui é o que a torna cliente da loja. Diz o que a loja vai
 * ver (nome, e-mail e telefone) antes do botão; `volta` é para onde segue depois (o Agendar, por exemplo).
 */
export function UsarMinhaConta({
  slug,
  volta = null,
  person,
  label = 'Usar minha conta nesta loja',
}: {
  slug: string
  volta?: string | null
  person?: { name: string; email: string; phone: string | null }
  label?: string
}) {
  const [state, formAction, pending] = useActionState(usarMinhaConta, INICIAL)
  return (
    <form action={formAction} className="af-cl-join" aria-labelledby="usar-conta-titulo">
      <input type="hidden" name="slug" value={slug} />
      {volta ? <input type="hidden" name="volta" value={volta} /> : null}
      <h2 id="usar-conta-titulo" className="af-cl-join__title">
        Usar minha conta nesta loja
      </h2>
      <p className="af-cl-join__text">A loja vai ver seu nome, e-mail e telefone.</p>
      {person ? (
        <dl className="af-cl-join__facts">
          <div>
            <dt>Nome</dt>
            <dd>{person.name}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{person.email}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{person.phone ?? 'Sem telefone'}</dd>
          </div>
        </dl>
      ) : null}
      {state.error ? (
        <p role="alert" className="af-cl-error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        {label}
      </Button>
    </form>
  )
}
