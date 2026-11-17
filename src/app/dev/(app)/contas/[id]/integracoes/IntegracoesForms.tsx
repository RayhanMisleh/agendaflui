'use client'
import { useActionState, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Card, ConfirmDialog, CopyButton, Field, FormErrors, Input, StatusDot } from '@/ui/components'
import { estadoInicial } from '../forms'
import type { AcaoConta } from '../forms'

/** As ações das integrações, já com o id da conta ligado no servidor pela página. */
export type AcoesIntegracoes = {
  salvarMercadoPago: AcaoConta
  removerMercadoPago: AcaoConta
  salvarFrenet: AcaoConta
  removerFrenet: AcaoConta
}

/** O que a tela sabe: situação e os 4 últimos caracteres. Segredo nenhum chega aqui. */
export type IntegracoesDados = {
  version: number
  mercadoPago: { configured: boolean; accessTokenLast4: string | null; webhookSecretLast4: string | null; webhookUrl: string | null; updatedLabel: string | null }
  frenet: { configured: boolean; tokenLast4: string | null; updatedLabel: string | null }
}

const ROTULOS = { accessToken: 'Token de acesso', webhookSecret: 'Assinatura secreta do webhook', token: 'Token da Frenet' }

/**
 * Formulário de uma integração. A versão vem sempre da página (as duas integrações compartilham a versão da conta, então
 * gravar uma atualiza a outra). Os campos são de senha, sem preenchimento e sem sugestão do navegador, e nunca recebem
 * valor: quem quer mudar digita de novo.
 */
function Formulario({ action, version, submit, children }: { action: AcaoConta; version: number; submit: string; children: (fields: Record<string, string>) => ReactNode }) {
  const [state, formAction, pending] = useActionState(action, estadoInicial({ version: String(version) }))
  return (
    <form action={formAction} className="af-acctform" noValidate>
      <input type="hidden" name="version" value={version} />
      {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={ROTULOS} />}
      {children(state.fields)}
      <div className="af-acctform__foot">
        <Button type="submit" variant="primary" loading={pending}>
          {submit}
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

function Segredo({ name, label, hint, error }: { name: string; label: string; hint: string; error: string | undefined }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Input type="password" name={name} autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue="" />
    </Field>
  )
}

function Remover({ rotulo, titulo, aviso, action, version, ativo }: { rotulo: string; titulo: string; aviso: string; action: AcaoConta; version: number; ativo: boolean }) {
  const [aberto, setAberto] = useState(false)
  if (!ativo) return null
  return (
    <div>
      <Button variant="danger" size="sm" onClick={() => setAberto(true)} aria-label={rotulo}>
        Remover
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={titulo}
        description={aviso}
        action={action}
        initialState={estadoInicial({ version: String(version) })}
        confirmLabel="Remover"
        hidden={{ version: String(version) }}
      />
    </div>
  )
}

function Situacao({ configurado, detalhe }: { configurado: boolean; detalhe: string }) {
  return <StatusDot tone={configurado ? 'success' : 'neutral'} label={configurado ? 'Configurado' : 'Não configurado'} detail={configurado ? detalhe : undefined} />
}

/** Mercado Pago e Frenet da conta: situação, campos de senha vazios, remoção com confirmação e o endereço do webhook. */
export function IntegracoesForms({ dados, acoes }: { dados: IntegracoesDados; acoes: AcoesIntegracoes }) {
  const mp = dados.mercadoPago
  const fr = dados.frenet
  return (
    <div className="af-keys__list">
      <Card as="section" className="af-keycard" aria-labelledby="integ-mp">
        <div className="af-keycard__head">
          <h2 id="integ-mp" className="af-keycard__name">
            Mercado Pago
          </h2>
          <Situacao
            configurado={mp.configured}
            detalhe={`Token termina em ${mp.accessTokenLast4 ?? '----'}, assinatura termina em ${mp.webhookSecretLast4 ?? '----'}.${mp.updatedLabel ? ` Atualizado em ${mp.updatedLabel}.` : ''}`}
          />
        </div>
        <p className="af-integration__help">Recebe os pagamentos da loja da conta. Os dois campos são necessários na primeira vez; depois dá para trocar só um. Campo em branco mantém o que já está salvo.</p>
        <Formulario action={acoes.salvarMercadoPago} version={dados.version} submit="Salvar">
          {(fields) => (
            <>
              <Segredo name="accessToken" label="Token de acesso" hint="No painel do Mercado Pago, em Suas integrações, credenciais de produção. Começa com APP_USR- ou TEST-." error={fields.accessToken} />
              <Segredo name="webhookSecret" label="Assinatura secreta do webhook" hint="Gerada pelo Mercado Pago ao cadastrar o webhook abaixo." error={fields.webhookSecret} />
            </>
          )}
        </Formulario>
        {mp.webhookUrl ? (
          <div className="af-keycard">
            <h3 className="af-keys__title">Endereço do webhook</h3>
            <div className="af-integration__url">
              <code>{mp.webhookUrl}</code>
              <CopyButton text={mp.webhookUrl} label="Copiar o endereço do webhook" variant="secondary" />
            </div>
            <p className="af-integration__help">
              No painel do Mercado Pago, em Suas integrações &gt; Webhooks, cole este endereço, marque o evento Pagamentos e copie a assinatura secreta para o campo acima.
            </p>
          </div>
        ) : (
          <p className="af-integration__help">O endereço do webhook aparece aqui depois de salvar os dois campos.</p>
        )}
        <Remover
          ativo={mp.configured}
          rotulo="Remover o Mercado Pago"
          titulo="Remover o Mercado Pago"
          aviso="A conta para de receber pagamentos pela loja. O endereço do webhook muda: ao configurar de novo, cole o endereço novo no painel do Mercado Pago."
          action={acoes.removerMercadoPago}
          version={dados.version}
        />
      </Card>

      <Card as="section" className="af-keycard" aria-labelledby="integ-frenet">
        <div className="af-keycard__head">
          <h2 id="integ-frenet" className="af-keycard__name">
            Frenet
          </h2>
          <Situacao configurado={fr.configured} detalhe={`Token termina em ${fr.tokenLast4 ?? '----'}.${fr.updatedLabel ? ` Atualizado em ${fr.updatedLabel}.` : ''}`} />
        </div>
        <p className="af-integration__help">Calcula o frete das entregas da loja da conta.</p>
        <Formulario action={acoes.salvarFrenet} version={dados.version} submit="Salvar">
          {(fields) => <Segredo name="token" label="Token da Frenet" hint="Está em Minha conta, na área de integrações da Frenet." error={fields.token} />}
        </Formulario>
        <Remover
          ativo={fr.configured}
          rotulo="Remover a Frenet"
          titulo="Remover a Frenet"
          aviso="A loja da conta deixa de calcular o frete das entregas até configurar o token de novo."
          action={acoes.removerFrenet}
          version={dados.version}
        />
      </Card>
    </div>
  )
}
