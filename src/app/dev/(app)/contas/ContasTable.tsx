'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { ArrowRight, DoorOpen } from 'lucide-react'
import { Button, CopyButton, DataList, LinkButton, StatusLamp } from '@/ui/components'
import type { BusinessStatusKey, DataColumn } from '@/ui/components'
import type { FormState } from '../_lib/form-state'
import { entrarComo } from './actions'

export type ContaLinha = {
  id: string
  name: string
  slug: string
  status: BusinessStatusKey
  ownerName: string | null
  entrada: string
}

type EntrarState = FormState<{ businessId: string }>

function EntrarComo({ conta }: { conta: ContaLinha }) {
  const inicial: EntrarState = { ok: false, message: null, fields: {}, values: { businessId: conta.id } }
  const [state, action, pending] = useActionState(entrarComo, inicial)
  if (conta.status === 'ARCHIVED') {
    return (
      <Button size="sm" disabled title="Reative a conta para entrar como suporte." icon={<DoorOpen size={16} />}>
        Entrar como
      </Button>
    )
  }
  return (
    <form action={action}>
      <input type="hidden" name="businessId" value={conta.id} />
      <Button type="submit" size="sm" loading={pending} icon={<DoorOpen size={16} />} aria-label={`Entrar como suporte em ${conta.name}`}>
        Entrar como
      </Button>
      {state.message ? (
        <p role="alert" className="af-rowerror">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}

const COLUNAS: DataColumn<ContaLinha>[] = [
  {
    key: 'conta',
    header: 'Conta',
    primary: true,
    cell: (c) => (
      <span className="af-account">
        <Link href={`/contas/${c.id}`} className="af-account__name">
          {c.name}
        </Link>
        <span className="af-account__slug">{c.slug}</span>
      </span>
    ),
  },
  { key: 'situacao', header: 'Situação', nowrap: true, cell: (c) => <StatusLamp status={c.status} /> },
  { key: 'dono', header: 'Dono', cell: (c) => c.ownerName ?? 'Sem dono ativo' },
  {
    key: 'entrada',
    header: 'Link de entrada',
    cell: (c) => (
      <span className="af-entrylink">
        <span className="af-entrylink__url">{c.entrada}</span>
        <CopyButton text={c.entrada} label={`Copiar link de entrada de ${c.name}`} />
      </span>
    ),
  },
  {
    key: 'acoes',
    header: <span className="af-sr">Ações</span>,
    cell: (c) => (
      <span className="af-rowactions">
        <LinkButton href={`/contas/${c.id}`} size="sm" icon={<ArrowRight size={16} />}>
          Abrir
        </LinkButton>
        <EntrarComo conta={c} />
      </span>
    ),
  },
]

/** A lista de contas: tabela no computador e cartões no celular (DataList). O texto da linha é o nome da conta. */
export function ContasTable({ contas, vazio }: { contas: ContaLinha[]; vazio: React.ReactNode }) {
  return <DataList label="Contas" columns={COLUNAS} rows={contas} rowKey={(c) => c.id} empty={vazio} />
}
