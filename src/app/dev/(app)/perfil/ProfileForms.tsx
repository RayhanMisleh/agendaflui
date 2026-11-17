'use client'
import { Field, Input, Paper } from '@/ui/components'
import { ContaForm } from '../contas/[id]/ContaForm'
import { estadoInicial } from '../contas/[id]/forms'
import type { AcaoConta } from '../contas/[id]/forms'

const ROTULOS = { senhaAtual: 'Senha atual', senhaNova: 'Senha nova', senhaRepetida: 'Repetir a senha nova' }

export function ProfileForms({ nome, email, salvar, trocar }: { nome: string; email: string; salvar: AcaoConta; trocar: AcaoConta }) {
  return (
    <div className="af-global">
      <Paper raised={1} className="af-keys__new">
        <h2 className="af-keys__title">Meus dados</h2>
        <ContaForm action={salvar} initial={estadoInicial({ name: nome })} submit="Salvar nome">
          {({ values: v, fields }) => (
            <>
              <Field label="Nome" error={fields.name}>
                <Input name="name" defaultValue={v.name} autoComplete="name" />
              </Field>
              <Field label="E-mail" hint="O e-mail é o da entrada e não muda por aqui.">
                <Input value={email} readOnly />
              </Field>
            </>
          )}
        </ContaForm>
      </Paper>
      <Paper raised={1} className="af-keys__new">
        <h2 className="af-keys__title">Trocar a senha</h2>
        <p className="af-section__help">Ao trocar, os outros acessos da sua conta de admin são encerrados. Este continua aberto.</p>
        <ContaForm action={trocar} initial={estadoInicial({})} submit="Trocar senha" labels={ROTULOS}>
          {({ fields }) => (
            <>
              <Field label="Senha atual" error={fields.senhaAtual}>
                <Input type="password" name="senhaAtual" autoComplete="current-password" />
              </Field>
              <Field label="Senha nova" hint="Pelo menos 10 caracteres." error={fields.senhaNova}>
                <Input type="password" name="senhaNova" autoComplete="new-password" />
              </Field>
              <Field label="Repetir a senha nova" error={fields.senhaRepetida}>
                <Input type="password" name="senhaRepetida" autoComplete="new-password" />
              </Field>
            </>
          )}
        </ContaForm>
      </Paper>
    </div>
  )
}
