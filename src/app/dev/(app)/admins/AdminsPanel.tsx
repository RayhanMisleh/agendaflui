'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button, ConfirmDialog, DataList, Field, Input, Card, StatusBadge } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { ContaForm } from '../contas/[id]/ContaForm'
import { estadoInicial } from '../contas/[id]/forms'
import type { AcaoConta } from '../contas/[id]/forms'

export type LinhaAdmin = {
  id: string
  name: string
  email: string
  active: boolean
  voce: boolean
  ultimoAcesso: string | null
  criadoEm: string
  /** Ação de desativar ou reativar, com o id do admin ligado no servidor. `null` na linha do próprio admin. */
  alternar: AcaoConta | null
}

function Alternar({ a, alternar }: { a: LinhaAdmin; alternar: AcaoConta }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button size="sm" variant={a.active ? 'danger' : 'secondary'} onClick={() => setAberto(true)} aria-label={`${a.active ? 'Desativar' : 'Reativar'} o admin ${a.name}`}>
        {a.active ? 'Desativar' : 'Reativar'}
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={`${a.active ? 'Desativar' : 'Reativar'} ${a.name}`}
        description={
          a.active
            ? 'A pessoa perde o acesso na hora e as sessões abertas dela são encerradas. Você pode reativar depois, mas ela precisará entrar de novo.'
            : 'A pessoa volta a poder entrar com o e-mail e a senha que já tinha.'
        }
        action={alternar}
        initialState={estadoInicial({ confirmName: '' })}
        confirmLabel={a.active ? 'Desativar admin' : 'Reativar admin'}
        {...(a.active ? { targetName: a.name } : {})}
      />
    </>
  )
}

const COLUNAS: DataColumn<LinhaAdmin>[] = [
  {
    key: 'nome',
    header: 'Nome',
    primary: true,
    cell: (a) => (
      <span className="af-acctcell">
        <strong className="af-account__name">{a.name}</strong>
        {a.voce ? (
          <Link href="/perfil" className="af-link-break">
            Você. Abrir meu perfil
          </Link>
        ) : null}
      </span>
    ),
  },
  { key: 'email', header: 'E-mail', cell: (a) => a.email },
  { key: 'situacao', header: 'Situação', cell: (a) => <StatusBadge tone={a.active ? 'confirmed' : 'neutral'}>{a.active ? 'Ativo' : 'Desativado'}</StatusBadge> },
  { key: 'acesso', header: 'Último acesso', nowrap: true, cell: (a) => a.ultimoAcesso ?? 'Nunca entrou' },
  { key: 'acao', header: 'Ação', cell: (a) => (a.alternar ? <Alternar a={a} alternar={a.alternar} /> : <span className="af-account__slug">Você não pode desativar o próprio acesso.</span>) },
]

export function AdminsPanel({ criar, admins }: { criar: AcaoConta; admins: LinhaAdmin[] }) {
  return (
    <div className="af-global">
      <Card className="af-listpanel">
        <h2 className="af-section__title">Admins da plataforma</h2>
        <DataList label="Admins da plataforma" columns={COLUNAS} rows={admins} rowKey={(a) => a.id} empty={null} />
      </Card>
      <Card className="af-keys__new">
        <h2 className="af-keys__title">Novo admin</h2>
        <p className="af-section__help">A pessoa entra com este e-mail e esta senha. Combine uma senha temporária e peça para ela trocar no perfil.</p>
        <ContaForm action={criar} initial={estadoInicial({ name: '', email: '' })} submit="Criar admin" labels={{ senha: 'Senha', email: 'E-mail' }}>
          {({ values: v, fields }) => (
            <>
              <Field label="Nome" error={fields.name}>
                <Input name="name" defaultValue={v.name} autoComplete="off" />
              </Field>
              <Field label="E-mail" error={fields.email}>
                <Input type="email" name="email" defaultValue={v.email} autoComplete="off" />
              </Field>
              <Field label="Senha" hint="Pelo menos 10 caracteres." error={fields.senha}>
                <Input type="password" name="senha" autoComplete="new-password" />
              </Field>
            </>
          )}
        </ContaForm>
      </Card>
    </div>
  )
}
