'use client'
import { useActionState, useState } from 'react'
import { ConfirmDialog, DataList, EmptyState, Button, Select, Stamp } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { alternarAcesso, reenviarConvite, trocarPapel } from './actions'
import { estadoInicial } from './forms'

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

function Papel({ businessId, m }: { businessId: string; m: Membro }) {
  const [state, action, pending] = useActionState(trocarPapel, estadoInicial({ businessId, membershipId: m.membershipId, role: m.role }))
  return (
    <form action={action} className="af-teamcell">
      <input type="hidden" name="businessId" value={businessId} />
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

function Acesso({ businessId, m }: { businessId: string; m: Membro }) {
  const [aberto, setAberto] = useState(false)
  const [state, action, pending] = useActionState(alternarAcesso, estadoInicial({ businessId, membershipId: m.membershipId, active: 'true', confirmName: '' }))
  const inicial = estadoInicial({ businessId, membershipId: m.membershipId, active: 'false', confirmName: '' })
  if (!m.active) {
    return (
      <form action={action} className="af-teamcell">
        <input type="hidden" name="businessId" value={businessId} />
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
        action={alternarAcesso}
        initialState={inicial}
        confirmLabel="Desativar acesso"
        targetName={m.name}
        hidden={{ businessId, membershipId: m.membershipId, active: 'false' }}
      />
    </>
  )
}

function Convite({ businessId, m }: { businessId: string; m: Membro }) {
  const [state, action, pending] = useActionState(reenviarConvite, estadoInicial({ businessId, membershipId: m.membershipId }))
  if (m.hasPassword || !m.active) return null
  return (
    <form action={action} className="af-teamcell">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="membershipId" value={m.membershipId} />
      <Button type="submit" size="sm" loading={pending} aria-label={`Reenviar o convite de ${m.name}`}>
        Reenviar convite
      </Button>
      <Aviso ok={state.ok} message={state.message} />
    </form>
  )
}

/** Equipe da conta: papel, situação, último acesso e as ações. As mensagens do domínio (último dono etc.) aparecem na linha. */
export function TeamPanel({ businessId, membros }: { businessId: string; membros: Membro[] }) {
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
    { key: 'papel', header: 'Papel', cell: (m) => <Papel businessId={businessId} m={m} /> },
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (m) => (
        <span className="af-teamstate">
          <Stamp tone={m.active ? 'ok' : 'neutral'}>{m.active ? 'Ativo' : 'Desativado'}</Stamp>
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
          <Acesso businessId={businessId} m={m} />
          <Convite businessId={businessId} m={m} />
        </span>
      ),
    },
  ]
  return (
    <DataList
      label="Equipe da conta"
      columns={colunas}
      rows={membros}
      rowKey={(m) => m.membershipId}
      empty={<EmptyState title="Esta conta não tem equipe" description="Quem foi vinculado à conta aparece aqui, com papel e situação." />}
    />
  )
}
