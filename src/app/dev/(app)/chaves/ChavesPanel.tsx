'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button, ConfirmDialog, EmptyState, Field, Input, Card, SecretBox, StatusBadge, Textarea } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { ContaForm } from '../contas/[id]/ContaForm'
import { estadoInicial } from '../contas/[id]/forms'
import type { AcaoConta } from '../contas/[id]/forms'

export type UsoPeriodo = { requests: number; errors: number; avgMs: number }
export type ChaveGlobal = {
  id: string
  name: string
  prefix: string
  kind: 'ACCOUNT' | 'PLATFORM'
  contaId: string | null
  contaNome: string | null
  origins: string[]
  revoked: boolean
  createdAt: string
  lastUsed: string | null
  uso7: UsoPeriodo
  uso30: UsoPeriodo
  routes: Array<{ route: string; count: number }>
  /** Revogar, com o id da chave ligado no servidor. */
  revogar: AcaoConta
}

function Uso({ titulo, uso }: { titulo: string; uso: UsoPeriodo }) {
  return (
    <div>
      <dt>{titulo}</dt>
      <dd>
        {uso.requests === 0
          ? 'Nenhuma requisição'
          : `${formatInt(uso.requests)} ${uso.requests === 1 ? 'requisição' : 'requisições'}, ${formatInt(uso.errors)} ${uso.errors === 1 ? 'erro' : 'erros'}, ${uso.avgMs} ms em média`}
      </dd>
    </div>
  )
}

function Cartao({ k }: { k: ChaveGlobal }) {
  const [aberto, setAberto] = useState(false)
  return (
    <Card as="li" className="af-keycard">
      <div className="af-keycard__head">
        <h3 className="af-keycard__name">{k.name}</h3>
        <StatusBadge tone={k.revoked ? 'canceled' : 'confirmed'}>{k.revoked ? 'Revogada' : 'Ativa'}</StatusBadge>
        <StatusBadge tone="neutral">{k.kind === 'PLATFORM' ? 'Plataforma' : 'Conta'}</StatusBadge>
      </div>
      <p className="af-account__slug">
        {k.kind === 'ACCOUNT' && k.contaId ? (
          <>
            Conta{' '}
            <Link href={`/contas/${k.contaId}/chaves`} className="af-link-break">
              {k.contaNome ?? 'abrir a conta'}
            </Link>
            .{' '}
          </>
        ) : null}
        Prefixo <code>{k.prefix}</code>. Criada em {k.createdAt}. {k.lastUsed ? `Último uso em ${k.lastUsed}.` : 'Ainda não foi usada.'}
      </p>
      <dl className="af-keycard__stats af-keycard__stats--wide" aria-label={`Uso da chave ${k.name}`}>
        <Uso titulo="Últimos 7 dias" uso={k.uso7} />
        <Uso titulo="Últimos 30 dias" uso={k.uso30} />
      </dl>
      {k.routes.length > 0 ? (
        <ol className="af-keycard__routes" aria-label={`Rotas mais chamadas pela chave ${k.name} em 30 dias`}>
          {k.routes.map((r) => (
            <li key={r.route}>
              <code>{r.route}</code> <span>{formatInt(r.count)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="af-account__slug">Origens permitidas: {k.origins.length > 0 ? k.origins.join(', ') : 'qualquer origem'}.</p>
      {k.revoked ? null : (
        <div>
          <Button variant="danger" size="sm" onClick={() => setAberto(true)} aria-label={`Revogar a chave ${k.name}`}>
            Revogar chave
          </Button>
          <ConfirmDialog
            open={aberto}
            onClose={() => setAberto(false)}
            title={`Revogar a chave ${k.name}`}
            description="O aplicativo que usa esta chave para de funcionar na hora. Não dá para desfazer: crie uma chave nova para substituir."
            action={k.revogar}
            initialState={estadoInicial({ confirmName: '' })}
            confirmLabel="Revogar chave"
            targetName={k.name}
          />
        </div>
      )}
    </Card>
  )
}

/** Chaves de toda a plataforma: criar chave de plataforma (o segredo aparece uma vez) e a lista com uso e revogação. */
export function ChavesPanel({ criar, chaves, filtros, vazio }: { criar: AcaoConta; chaves: ChaveGlobal[]; filtros: React.ReactNode; vazio: React.ReactNode }) {
  return (
    <div className="af-keys">
      <Card className="af-keys__new">
        <h2 className="af-keys__title">Nova chave de plataforma</h2>
        <p className="af-section__help">Serve para apps que falam com várias contas. A chave de uma conta só se cria na página da conta.</p>
        <ContaForm action={criar} initial={estadoInicial({ name: '', origins: '' })} submit="Criar chave">
          {({ values: v, fields, ok }) => (
            <>
              {ok && v.secret ? <SecretBox name={v.keyName ?? 'Chave de plataforma'} secret={v.secret} /> : null}
              <Field label="Nome da chave" hint="Só para reconhecer a chave na lista." error={fields.name}>
                <Input name="name" defaultValue={v.name} autoComplete="off" />
              </Field>
              <Field label="Origens permitidas (opcional)" hint="Uma por linha, como https://app.exemplo.com." error={fields.origins}>
                <Textarea name="origins" rows={2} defaultValue={v.origins} />
              </Field>
            </>
          )}
        </ContaForm>
      </Card>
      <Card className="af-listpanel">
        {filtros}
        {chaves.length === 0 ? (
          vazio
        ) : (
          <ul className="af-keys__list" aria-label="Chaves da plataforma">
            {chaves.map((k) => (
              <Cartao key={k.id} k={k} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export function SemChaves() {
  return <EmptyState title="Nenhuma chave ainda" description="Crie uma chave de plataforma acima, ou uma chave de conta na página da conta." />
}
