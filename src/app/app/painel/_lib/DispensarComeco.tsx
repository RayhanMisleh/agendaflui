'use client'
import { useState } from 'react'
import { Button, ConfirmDialog } from '@/ui/components'

type Estado = { ok: boolean; message: string | null; fields: Record<string, string> }
const INICIAL: Estado = { ok: false, message: null, fields: {} }

/**
 * "Dispensar o passo a passo": pede a confirmação num diálogo; confirmado, para os convites do começo e some a lista do
 * Início. A ação vem de quem usa (a do servidor), para este botão não puxar o servidor para dentro de testes de tela.
 */
export function DispensarComeco({ action, className }: { action(prev: Estado, form: FormData): Promise<Estado>; className?: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={() => setAberto(true)}>
        Dispensar o passo a passo
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Dispensar o passo a passo?"
        description="Dispensar? Você continua tudo pelas telas do painel."
        action={action}
        initialState={INICIAL}
        confirmLabel="Dispensar"
      />
    </>
  )
}
