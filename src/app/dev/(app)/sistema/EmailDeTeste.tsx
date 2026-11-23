'use client'
import { useActionState } from 'react'
import { Button } from '@/ui/components'
import type { AcaoConta } from '../contas/[id]/forms'
import { estadoInicial } from '../contas/[id]/forms'

/** Botão que manda um e-mail de teste ao próprio admin; o resultado aparece logo abaixo. */
export function EmailDeTeste({ acao }: { acao: AcaoConta }) {
  const [estado, enviar, pending] = useActionState(acao, estadoInicial({}))
  return (
    <form action={enviar}>
      <Button type="submit" variant="secondary" loading={pending}>
        Enviar e-mail de teste para mim
      </Button>
      {estado.message ? (
        <p role={estado.ok ? 'status' : 'alert'} className={estado.ok ? 'af-global__msg af-global__msg--ok' : 'af-global__msg'}>
          {estado.message}
        </p>
      ) : null}
    </form>
  )
}
