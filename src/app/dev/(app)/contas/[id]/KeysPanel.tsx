'use client'
import { useActionState, useState } from 'react'
import { ConfirmDialog, Button, EmptyState, Field, Paper, SecretBox, Stamp, Textarea, Input } from '@/ui/components'
import { criarChave, editarOrigens, revogarChave } from './actions'
import { ContaForm } from './ContaForm'
import { estadoInicial } from './forms'

const INT = new Intl.NumberFormat('pt-BR')

export type ChaveUso = { requests: number; errors: number; avgMs: number; routes: Array<{ route: string; count: number }> }
export type Chave = {
  id: string
  name: string
  prefix: string
  origins: string[]
  revoked: boolean
  createdAt: string
  lastUsed: string | null
  usage: ChaveUso
}

function Uso({ uso }: { uso: ChaveUso }) {
  if (uso.requests === 0) return <p className="af-keycard__usage">Nenhuma requisição nos últimos 7 dias.</p>
  return (
    <div className="af-keycard__usage">
      <dl className="af-keycard__stats" aria-label="Uso nos últimos 7 dias">
        <div>
          <dt>Requisições</dt>
          <dd>{INT.format(uso.requests)}</dd>
        </div>
        <div>
          <dt>Erros</dt>
          <dd>{INT.format(uso.errors)}</dd>
        </div>
        <div>
          <dt>Tempo médio</dt>
          <dd>{uso.avgMs} ms</dd>
        </div>
      </dl>
      <ol className="af-keycard__routes" aria-label="Rotas mais chamadas">
        {uso.routes.map((r) => (
          <li key={r.route}>
            <code>{r.route}</code> <span>{INT.format(r.count)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Origens({ businessId, k }: { businessId: string; k: Chave }) {
  const [state, action, pending] = useActionState(editarOrigens, estadoInicial({ businessId, keyId: k.id, origins: k.origins.join('\n') }))
  return (
    <form action={action} className="af-keycard__origins" noValidate>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="keyId" value={k.id} />
      <Field label="Origens permitidas" hint="Uma por linha, como https://app.exemplo.com. Em branco, qualquer origem com a chave." error={state.fields.origins ?? (state.ok ? undefined : state.message ?? undefined)}>
        <Textarea name="origins" rows={2} defaultValue={state.values.origins} />
      </Field>
      <div className="af-acctform__foot">
        <Button type="submit" size="sm" loading={pending}>
          Salvar origens
        </Button>
        {state.ok && state.message ? (
          <p role="status" className="af-acctform__ok">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}

function Cartao({ businessId, k }: { businessId: string; k: Chave }) {
  const [aberto, setAberto] = useState(false)
  return (
    <Paper as="li" raised={1} className="af-keycard">
      <div className="af-keycard__head">
        <h3 className="af-keycard__name">{k.name}</h3>
        <Stamp tone={k.revoked ? 'bad' : 'ok'}>{k.revoked ? 'Revogada' : 'Ativa'}</Stamp>
      </div>
      <p className="af-account__slug">
        Prefixo <code>{k.prefix}</code>. Criada em {k.createdAt}. {k.lastUsed ? `Último uso em ${k.lastUsed}.` : 'Ainda não foi usada.'}
      </p>
      <Uso uso={k.usage} />
      {k.revoked ? (
        <p className="af-account__slug">Origens: {k.origins.length > 0 ? k.origins.join(', ') : 'qualquer origem'}.</p>
      ) : (
        <>
          <Origens businessId={businessId} k={k} />
          <div>
            <Button variant="danger" size="sm" onClick={() => setAberto(true)} aria-label={`Revogar a chave ${k.name}`}>
              Revogar chave
            </Button>
            <ConfirmDialog
              open={aberto}
              onClose={() => setAberto(false)}
              title={`Revogar a chave ${k.name}`}
              description="O aplicativo que usa esta chave para de funcionar na hora. Não dá para desfazer: crie uma chave nova para substituir."
              action={revogarChave}
              initialState={estadoInicial({ businessId, keyId: k.id, confirmName: '' })}
              confirmLabel="Revogar chave"
              targetName={k.name}
              hidden={{ businessId, keyId: k.id }}
            />
          </div>
        </>
      )}
    </Paper>
  )
}

/** Chaves de app da conta: criar (o segredo aparece uma vez, no estado da ação), listar com uso, editar origens e revogar. */
export function KeysPanel({ businessId, chaves }: { businessId: string; chaves: Chave[] }) {
  return (
    <div className="af-keys">
      <Paper raised={1} className="af-keys__new">
        <h2 className="af-keys__title">Nova chave</h2>
        <ContaForm action={criarChave} initial={estadoInicial({ businessId, name: '', origins: '' })} submit="Criar chave">
          {({ values: v, fields, ok }) => (
            <>
              {ok && v.secret ? <SecretBox name={v.keyName ?? 'Chave de app'} secret={v.secret} /> : null}
              <Field label="Nome da chave" hint="Só para reconhecer a chave na lista." error={fields.name}>
                <Input name="name" defaultValue={v.name} autoComplete="off" />
              </Field>
              <Field label="Origens permitidas (opcional)" hint="Uma por linha, como https://app.exemplo.com." error={fields.origins}>
                <Textarea name="origins" rows={2} defaultValue={v.origins} />
              </Field>
            </>
          )}
        </ContaForm>
      </Paper>
      {chaves.length === 0 ? (
        <EmptyState title="Esta conta ainda não tem chave" description="Crie a chave que o aplicativo da conta usa para falar com a API." />
      ) : (
        <ul className="af-keys__list" aria-label="Chaves da conta">
          {chaves.map((k) => (
            <Cartao key={k.id} businessId={businessId} k={k} />
          ))}
        </ul>
      )}
    </div>
  )
}
