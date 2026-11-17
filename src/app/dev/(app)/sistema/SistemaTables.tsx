'use client'
import { useState, useTransition } from 'react'
import { Button, DataList, StatusDot } from '@/ui/components'
import type { DataColumn, StateTone } from '@/ui/components'
import { estadoInicial } from '../contas/[id]/forms'
import type { AcaoConta } from '../contas/[id]/forms'

export type Falha = { chave: string; quando: string; tipo: string; codigo: string; conta: string | null; tentar: AcaoConta | null }
export type Execucao = { chave: string; tipo: string; inicio: string; duracao: string; ok: boolean; resumo: string }
export type TabelaGrande = { nome: string; tamanho: string }

type Resultado = { ok: boolean; message: string }

/**
 * O botão só dispara a ação; a confirmação aparece fora da linha (em `FalhasTable`), porque a linha some da lista assim que o
 * aviso volta à fila e levaria a mensagem junto.
 */
function TentarDeNovo({ acao, aviso, onResultado }: { acao: AcaoConta; aviso: string; onResultado: (r: Resultado | null) => void }) {
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      loading={pending}
      aria-label={`Tentar de novo: ${aviso}`}
      onClick={() => {
        // Nova tentativa: some a mensagem da anterior até haver resposta.
        onResultado(null)
        start(async () => {
          const r = await acao(estadoInicial({}), new FormData())
          onResultado(r.message ? { ok: r.ok, message: r.message } : null)
        })
      }}
    >
      Tentar de novo
    </Button>
  )
}

const COLUNAS_FALHAS = (onResultado: (r: Resultado | null) => void): DataColumn<Falha>[] => [
  { key: 'quando', header: 'Quando', primary: true, nowrap: true, cell: (f) => f.quando },
  { key: 'tipo', header: 'O que falhou', cell: (f) => <code>{f.tipo}</code> },
  { key: 'codigo', header: 'Código', cell: (f) => <code>{f.codigo}</code> },
  { key: 'conta', header: 'Conta', cell: (f) => f.conta ?? 'Sem conta' },
  {
    key: 'acao',
    header: 'Ação',
    cell: (f) =>
      f.tentar ? <TentarDeNovo acao={f.tentar} aviso={`${f.tipo} de ${f.conta ?? 'sem conta'}`} onResultado={onResultado} /> : 'Só o aviso pode ser reenviado',
  },
]

export function FalhasTable({ falhas, vazio }: { falhas: Falha[]; vazio: React.ReactNode }) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  return (
    <>
      <DataList label="Falhas recentes" columns={COLUNAS_FALHAS(setResultado)} rows={falhas} rowKey={(f) => f.chave} empty={vazio} />
      {resultado ? (
        <p role={resultado.ok ? 'status' : 'alert'} className={resultado.ok ? 'af-global__msg af-global__msg--ok' : 'af-global__msg'}>
          {resultado.message}
        </p>
      ) : null}
    </>
  )
}

const COLUNAS_EXECUCOES: DataColumn<Execucao>[] = [
  { key: 'tipo', header: 'Tarefa', primary: true, cell: (e) => <code>{e.tipo}</code> },
  {
    key: 'situacao',
    header: 'Situação',
    cell: (e) => {
      const tone: StateTone = e.ok ? 'success' : 'danger'
      return <StatusDot tone={tone} label={e.ok ? 'Concluída' : 'Falhou'} />
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

