'use client'
import { useActionState, useState } from 'react'
import { Button, Card, ConfirmDialog, CopyButton, Field, FormErrors, Input, StatusDot } from '@/ui/components'
import { estadoInicial } from '../../contas/[id]/forms'
import type { AcaoConta } from '../../contas/[id]/forms'

export type GoogleDados = {
  configured: boolean
  clientId: string | null
  secretLast4: string | null
  savedLabel: string | null
  redirectUrl: string
  version: number
}

const ROTULOS = { clientId: 'ID do cliente', clientSecret: 'Chave secreta' }

/** Chaves do "Entrar com Google": situação, URL de retorno para copiar e os dois campos. A chave secreta nunca volta à tela. */
export function GoogleForm({ dados, acoes }: { dados: GoogleDados; acoes: { salvar: AcaoConta; remover: AcaoConta } }) {
  const [state, formAction, pending] = useActionState(acoes.salvar, estadoInicial({ version: String(dados.version), clientId: dados.clientId ?? '' }))
  const [aberto, setAberto] = useState(false)
  // A versão vem sempre da página (revalidada por salvar e por remover): a do estado do salvar ficaria velha depois de remover.
  const versao = String(dados.version)
  return (
    <div className="af-keys__list">
      <Card as="section" className="af-keycard" aria-labelledby="google-titulo">
        <div className="af-keycard__head">
          <h2 id="google-titulo" className="af-keycard__name">
            Entrar com Google
          </h2>
          <StatusDot
            tone={dados.configured ? 'success' : 'neutral'}
            label={dados.configured ? 'Ligado' : 'Desligado'}
            detail={dados.configured ? `Chave termina em ${dados.secretLast4 ?? '----'}.${dados.savedLabel ? ` Salva em ${dados.savedLabel}.` : ''}` : undefined}
          />
        </div>
        <p className="af-integration__help">
          Com as chaves salvas, o botão &quot;Continuar com Google&quot; aparece na entrada, no cadastro das lojas e no convite. Sem elas, ele some.
        </p>
        <div className="af-keycard">
          <h3 className="af-keys__title">URL de retorno</h3>
          <div className="af-integration__url">
            <code>{dados.redirectUrl}</code>
            <CopyButton text={dados.redirectUrl} label="Copiar a URL de retorno" variant="secondary" />
          </div>
          <p className="af-integration__help">Cole no console do Google em URIs de redirecionamento autorizados.</p>
        </div>
        <form action={formAction} className="af-acctform" noValidate>
          <input type="hidden" name="version" value={versao} />
          {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={ROTULOS} />}
          <Field label="ID do cliente" hint="Termina em .apps.googleusercontent.com." error={state.fields.clientId}>
            <Input name="clientId" autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue={state.values.clientId ?? ''} />
          </Field>
          <Field
            label="Chave secreta"
            hint={dados.configured ? `Deixe em branco para manter a atual (termina em ${dados.secretLast4 ?? '----'}).` : 'Cole a chave secreta do cliente OAuth.'}
            error={state.fields.clientSecret}
          >
            <Input type="password" name="clientSecret" autoComplete="new-password" autoCapitalize="none" spellCheck={false} defaultValue="" />
          </Field>
          <div className="af-acctform__foot">
            <Button type="submit" variant="primary" loading={pending}>
              Salvar
            </Button>
            {state.ok && state.message ? (
              <p role="status" className="af-acctform__ok">
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
        {dados.configured ? (
          <div>
            <Button variant="danger" size="sm" onClick={() => setAberto(true)}>
              Remover chaves
            </Button>
            <ConfirmDialog
              open={aberto}
              onClose={() => setAberto(false)}
              title="Remover as chaves do Google"
              description="O botão Continuar com Google some de todas as telas. Quem já vinculou o Google continua entrando com e-mail e senha."
              action={acoes.remover}
              initialState={estadoInicial({ version: versao })}
              confirmLabel="Remover chaves"
              hidden={{ version: versao }}
            />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
