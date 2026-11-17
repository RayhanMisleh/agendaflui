'use client'
import { useActionState } from 'react'
import { Button, DataList, Lamp } from '@/ui/components'
import type { DataColumn, LampState } from '@/ui/components'
import { estadoInicial } from '../contas/[id]/forms'
import type { AcaoConta } from '../contas/[id]/forms'

export type Falha = { chave: string; quando: string; tipo: string; codigo: string; conta: string | null; tentar: AcaoConta | null }
export type Execucao = { chave: string; tipo: string; inicio: string; duracao: string; ok: boolean; resumo: string }
export type TabelaGrande = { nome: string; tamanho: string }

function TentarDeNovo({ acao, aviso }: { acao: AcaoConta; aviso: string }) {
  const [state, action, pending] = useActionState(acao, estadoInicial({}))
  return (
    <div className="af-global__retry">
      <form action={action}>
        <Button type="submit" size="sm" variant="secondary" loading={pending} aria-label={`Tentar de novo: ${aviso}`}>
          Tentar de novo
        </Button>
      </form>
      {state.message ? (
        <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'af-global__msg af-global__msg--ok' : 'af-global__msg'}>
          {state.message}
        </p>
      ) : null}
    </div>
  )
}

const COLUNAS_FALHAS: DataColumn<Falha>[] = [
  { key: 'quando', header: 'Quando', primary: true, nowrap: true, cell: (f) => f.quando },
  { key: 'tipo', header: 'O que falhou', cell: (f) => <code>{f.tipo}</code> },
  { key: 'codigo', header: 'Código', cell: (f) => <code>{f.codigo}</code> },
  { key: 'conta', header: 'Conta', cell: (f) => f.conta ?? 'Sem conta' },
  {
    key: 'acao',
    header: 'Ação',
    cell: (f) => (f.tentar ? <TentarDeNovo acao={f.tentar} aviso={`${f.tipo} de ${f.conta ?? 'sem conta'}`} /> : 'Só o aviso pode ser reenviado'),
  },
]

export function FalhasTable({ falhas, vazio }: { falhas: Falha[]; vazio: React.ReactNode }) {
  return <DataList label="Falhas recentes" columns={COLUNAS_FALHAS} rows={falhas} rowKey={(f) => f.chave} empty={vazio} />
}

const COLUNAS_EXECUCOES: DataColumn<Execucao>[] = [
  { key: 'tipo', header: 'Tarefa', primary: true, cell: (e) => <code>{e.tipo}</code> },
  {
    key: 'situacao',
    header: 'Situação',
    cell: (e) => {
      const state: LampState = e.ok ? 'on' : 'error'
      return <Lamp state={state} label={e.ok ? 'Concluída' : 'Falhou'} />
    },
  },
  { key: 'inicio', header: 'Início', nowrap: true, cell: (e) => e.inicio },
  { key: 'duracao', header: 'Duração', nowrap: true, cell: (e) => e.duracao },
  { key: 'resumo', header: 'Resumo', cell: (e) => e.resumo || 'Sem resumo' },
]

export function ExecucoesTable({ execucoes, vazio }: { execucoes: Execucao[]; vazio: React.ReactNode }) {
  return <DataList label="Últimas execuções do agendador" columns={COLUNAS_EXECUCOES} rows={execucoes} rowKey={(e) => e.chave} empty={vazio} />
}

const COLUNAS_TABELAS: DataColumn<TabelaGrande>[] = [
  { key: 'nome', header: 'Tabela', primary: true, cell: (t) => <code>{t.nome}</code> },
  { key: 'tamanho', header: 'Tamanho', align: 'end', nowrap: true, cell: (t) => t.tamanho },
]

export function TabelasTable({ tabelas }: { tabelas: TabelaGrande[] }) {
  return <DataList label="Maiores tabelas do banco" columns={COLUNAS_TABELAS} rows={tabelas} rowKey={(t) => t.nome} empty={null} />
}

