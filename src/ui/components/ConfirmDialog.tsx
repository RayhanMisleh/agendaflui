'use client'
import { useActionState, useId, useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Field } from './Field'
import { FormErrors } from './FormErrors'
import { Input } from './Input'
import { useHydrated } from './use-hydrated'

type ConfirmState = { ok: boolean; message: string | null; fields: Record<string, string> }

/**
 * O formulário de confirmação, sem moldura. Com `targetName` (ação destrutiva) a pessoa digita o nome exato do alvo e o
 * botão só habilita quando bate; a ação de servidor confere de novo. Sem JavaScript o botão fica habilitado (a ação
 * de servidor é a barreira), por isso o mesmo formulário serve de página de confirmação.
 */
export function ConfirmForm({
  action,
  initialState,
  confirmLabel,
  targetName,
  hidden = {},
  description,
  onCancel,
}: {
  // Sintaxe de método: a ação pode devolver um estado com mais campos (`values`) do que estes três.
  action(prev: ConfirmState, form: FormData): Promise<ConfirmState>
  initialState: ConfirmState
  confirmLabel: string
  targetName?: string
  hidden?: Record<string, string>
  description?: string
  onCancel?: () => void
}) {
  const [state, formAction, pending] = useActionState(action, initialState)
  const [typed, setTyped] = useState('')
  const hidratado = useHydrated()
  const uid = useId()
  const exige = targetName !== undefined
  const confere = !exige || typed === targetName
  const erroDoCampo = state.fields.confirmName
  const outrosErros = Object.fromEntries(Object.entries(state.fields).filter(([k]) => k !== 'confirmName'))

  return (
    <form action={formAction} className="af-confirm">
      {description ? <p className="af-confirm__text">{description}</p> : null}
      {Object.entries(hidden).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      {exige ? (
        <Field label={`Digite ${targetName} para confirmar`} error={erroDoCampo}>
          <Input
            id={`${uid}-confirmar`}
            name="confirmName"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      ) : null}
      <FormErrors message={erroDoCampo ? null : state.message} fields={outrosErros} />
      <div className="af-confirm__actions">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" variant={exige ? 'danger' : 'primary'} disabled={hidratado && !confere} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  )
}

/** Confirmação em folha sobre a página. Fecha por Esc, clique fora e Cancelar; quem manda é o estado `open` de quem chama. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  ...form
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  action(prev: ConfirmState, form: FormData): Promise<ConfirmState>
  initialState: ConfirmState
  confirmLabel: string
  targetName?: string
  hidden?: Record<string, string>
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <ConfirmForm {...form} description={description} onCancel={onClose} />
    </Dialog>
  )
}
