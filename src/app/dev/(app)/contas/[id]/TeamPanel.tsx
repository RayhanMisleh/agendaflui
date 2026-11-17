'use client'
import { useActionState, useState } from 'react'
import { ConfirmDialog, DataList, EmptyState, Button, Field, Input, Select, StatusBadge } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { estadoInicial } from './forms'
import type { AcaoConta } from './forms'

/** As ações da equipe, já com o id da conta ligado no servidor pela página. */
export type AcoesEquipe = { trocarPapel: AcaoConta; alternarAcesso: AcaoConta; reenviarConvite: AcaoConta; convidarMembro: AcaoConta }

export type Membro = {
  membershipId: string
  name: string
  email: string
  role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL'
  active: boolean
  hasPassword: boolean
  lastLogin: string | null
}

const PAPEIS: Array<[Membro['role'], string]> = [
  ['OWNER', 'Dono'],
  ['MANAGER', 'Gerente'],
  ['PROFESSIONAL', 'Profissional'],
]

function Aviso({ ok, message }: { ok: boolean; message: string | null }) {
  if (!message) return null
  return (
    <p role={ok ? 'status' : 'alert'} className={ok ? 'af-acctform__ok' : 'af-rowerror'}>
      {message}
    </p>
  )
}

function Papel({ acoes, m }: { acoes: AcoesEquipe; m: Membro }) {
  const [state, action, pending] = useActionState(acoes.trocarPapel, estadoInicial({ membershipId: m.membershipId, role: m.role }))
  return (
    <form action={action} className="af-teamcell">
      <input type="hidden" name="membershipId" value={m.membershipId} />
      <Select name="role" defaultValue={state.values.role ?? m.role} aria-label={`Papel de ${m.name}`}>
        {PAPEIS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" loading={pending} aria-label={`Trocar o papel de ${m.name}`}>
        Trocar papel
      </Button>
      <Aviso ok={state.ok} message={state.message} />
    </form>
  )
}

function Acesso({ acoes, m }: { acoes: AcoesEquipe; m: Membro }) {
  const [aberto, setAberto] = useState(false)
  const [state, action, pending] = useActionState(acoes.alternarAcesso, estadoInicial({ membershipId: m.membershipId, active: 'true', confirmName: '' }))
  const inicial = estadoInicial({ membershipId: m.membershipId, active: 'false', confirmName: '' })
  if (!m.active) {
    return (
      <form action={action} className="af-teamcell">
          <input type="hidden" name="membershipId" value={m.membershipId} />
        <input type="hidden" name="active" value="true" />
        <Button type="submit" size="sm" loading={pending} aria-label={`Reativar o acesso de ${m.name}`}>
          Reativar acesso
        </Button>
        <Aviso ok={state.ok} message={state.message} />
      </form>
    )
  }
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setAberto(true)} aria-label={`Desativar o acesso de ${m.name}`}>
        Desativar acesso
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={`Desativar o acesso de ${m.name}`}
        description="A pessoa sai das sessões abertas e deixa de entrar nesta conta. Você pode reativar o acesso depois."
        action={acoes.alternarAcesso}
        initialState={inicial}
        confirmLabel="Desativar acesso"
        targetName={m.name}
        hidden={{ membershipId: m.membershipId, active: 'false' }}
      />
    </>
  )
}

function Convite({ acoes, m }: { acoes: AcoesEquipe; m: Membro }) {
  const [state, action, pending] = useActionState(acoes.reenviarConvite, estadoInicial({ membershipId: m.membershipId }))
  if (m.hasPassword || !m.active) return null
  return (
    <form action={action} className="af-teamcell">
      <input type="hidden" name="membershipId" value={m.membershipId} />
      <Button type="submit" size="sm" loading={pending} aria-label={`Reenviar o convite de ${m.name}`}>
        Reenviar convite
      </Button>
      <Aviso ok={state.ok} message={state.message} />
    </form>
  )
}

/** Convite de uma pessoa nova: nome, e-mail e papel. Funciona sem JavaScript; as mensagens do domínio aparecem no formulário. */
function ConvidarForm({ acoes }: { acoes: AcoesEquipe }) {
  const [state, action, pending] = useActionState(acoes.convidarMembro, estadoInicial({ name: '', email: '', role: 'PROFESSIONAL' }))
  const erro = state.ok ? undefined : state.message
  return (
    <form action={action} className="af-invite">
      <div className="af-invite__fields">
        <Field label="Nome" error={state.fields.name}>
          <Input name="name" defaultValue={state.values.name ?? ''} autoComplete="off" />
        </Field>
        <Field label="E-mail" error={state.fields.email}>
          <Input name="email" type="email" inputMode="email" defaultValue={state.values.email ?? ''} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="Papel" error={state.fields.role}>
          <Select name="role" defaultValue={state.values.role ?? 'PROFESSIONAL'}>
            {PAPEIS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="af-invite__go">
        <Button type="submit" variant="primary" loading={pending}>
          Convidar pessoa
        </Button>
        {state.ok && state.message ? (
          <p role="status" className="af-acctform__ok">
            {state.message}
          </p>
        ) : null}
        {erro && Object.keys(state.fields).length === 0 ? (
          <p role="alert" className="af-rowerror">
            {erro}
          </p>
        ) : null}
      </div>
    </form>
  )
}

/** Equipe da conta: papel, situação, último acesso e as ações. As mensagens do domínio (último dono etc.) aparecem na linha. */
export function TeamPanel({ acoes, membros }: { acoes: AcoesEquipe; membros: Membro[] }) {
  const colunas: DataColumn<Membro>[] = [
    {
      key: 'pessoa',
      header: 'Pessoa',
      primary: true,
      cell: (m) => (
        <span className="af-account">
          <span className="af-account__name">{m.name}</span>
          <span className="af-account__slug">{m.email}</span>
        </span>
      ),
    },
    { key: 'papel', header: 'Papel', cell: (m) => <Papel acoes={acoes} m={m} /> },
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (m) => (
        <span className="af-teamstate">
          <StatusBadge tone={m.active ? 'confirmed' : 'neutral'}>{m.active ? 'Ativo' : 'Desativado'}</StatusBadge>
          {m.active && !m.hasPassword ? <span className="af-account__slug">Convite pendente</span> : null}
        </span>
      ),
    },
    { key: 'acesso', header: 'Último acesso', nowrap: true, cell: (m) => m.lastLogin ?? 'Nunca entrou' },
    {
      key: 'acoes',
      header: <span className="af-sr">Ações</span>,
      cell: (m) => (
        <span className="af-rowactions">
          <Acesso acoes={acoes} m={m} />
          <Convite acoes={acoes} m={m} />
        </span>
      ),
    },
  ]
  return (
    <div className="af-team">
      <ConvidarForm acoes={acoes} />
      <DataList
        label="Equipe da conta"
        columns={colunas}
        rows={membros}
        rowKey={(m) => m.membershipId}
        empty={<EmptyState title="Esta conta não tem equipe" description="Convide a primeira pessoa no formulário acima: ela aparece aqui, com papel e situação." />}
      />
    </div>
  )
}
