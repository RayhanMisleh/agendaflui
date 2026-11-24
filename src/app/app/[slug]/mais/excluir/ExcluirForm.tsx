'use client'
import { Trash2 } from 'lucide-react'
import { Field, Input } from '@/ui/components'
import { ClienteForm } from '../../_lib/ClienteForm'
import { excluirConta } from '../actions'

/** Confirma quem pede: com senha, a senha; só com Google, a palavra "excluir". Erro aparece no alto, sem apagar o digitado. */
export function ExcluirForm({ slug, hasPassword }: { slug: string; hasPassword: boolean }) {
  return (
    <ClienteForm action={excluirConta} slug={slug} submit="Excluir minha conta nesta loja" variant="danger" submitIcon={<Trash2 size={18} />}>
      {(state) =>
        hasPassword ? (
          <Field label="Sua senha" error={state.fields.password}>
            <Input name="password" type="password" autoComplete="current-password" maxLength={200} required invalid={Boolean(state.fields.password)} />
          </Field>
        ) : (
          <Field label="Digite excluir para confirmar" error={state.fields.confirm}>
            <Input name="confirm" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} required invalid={Boolean(state.fields.confirm)} />
          </Field>
        )
      }
    </ClienteForm>
  )
}
