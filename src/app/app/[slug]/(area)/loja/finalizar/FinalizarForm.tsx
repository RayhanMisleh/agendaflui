'use client'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, ChoiceCard, Field, Sheet, Textarea } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import type { ShippingQuote } from '@/server/domain/store/shipping'
import type { Pedido } from '../../../_lib/consulta'
import { ClienteForm } from '../../../_lib/ClienteForm'
import { EnderecoForm, type EnderecoDoForm } from '../enderecos/EnderecoForm'
import { fazerPedido } from '../actions'
import { cotarFrete } from '../consultas'

export type OpcoesDaLoja = { pickup: { enabled: boolean; instructions: string | null }; shipping: { enabled: boolean }; payment: { available: boolean } }
export type ResumoDoPedido = { linhas: { name: string; quantity: number; totalCents: number }[]; itemsCents: number }

type RespostaDaCotacao = { para: string; r: Pedido<{ cotacao: ShippingQuote }> }

const prazo = (dias: number): string => (dias <= 1 ? 'até 1 dia útil' : `até ${dias} dias úteis`)

/**
 * Finalizar: como receber (retirar ou entregar), endereço e frete (cotado na hora, assinado pelo servidor), recado e o resumo.
 * "Ir para o pagamento" cria o pedido e leva ao Mercado Pago. A chave do pedido vem do servidor ao abrir a tela: o toque
 * duplo grava um pedido só.
 */
export function FinalizarForm({ slug, options, enderecos, resumo, nomeInicial, chave }: { slug: string; options: OpcoesDaLoja; enderecos: EnderecoDoForm[]; resumo: ResumoDoPedido; nomeInicial: string; chave: string }) {
  const entregaLigada = options.shipping.enabled
  const [modo, setModo] = useState<'PICKUP' | 'SHIPPING'>(options.pickup.enabled ? 'PICKUP' : 'SHIPPING')
  const [addressId, setAddressId] = useState<string>(enderecos.find((e) => e.isDefault)?.id ?? enderecos[0]?.id ?? '')
  const [resposta, setResposta] = useState<RespostaDaCotacao | null>(null)
  const [opcao, setOpcao] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  // Cota o frete do endereço escolhido. Uma cotação por vez: trocar de endereço ou de modo descarta a resposta da anterior.
  const alvo = modo === 'SHIPPING' && addressId !== '' ? addressId : null
  useEffect(() => {
    if (alvo === null) return
    let vivo = true
    void cotarFrete(slug, alvo).then((r) => {
      if (!vivo) return
      setResposta({ para: alvo, r })
      if (r.ok) setOpcao(r.cotacao.options[0]?.serviceCode ?? null)
    })
    return () => {
      vivo = false
    }
  }, [alvo, slug])
  const cotacao = alvo !== null && resposta?.para === alvo ? resposta.r : null
  const carregando = alvo !== null && cotacao === null

  const escolhida = cotacao?.ok ? (cotacao.cotacao.options.find((o) => o.serviceCode === opcao) ?? null) : null
  const frete = modo === 'SHIPPING' ? (escolhida?.priceCents ?? 0) : 0
  const semPagamento = !options.payment.available
  const semForma = !options.pickup.enabled && !entregaLigada
  const faltaEscolha = modo === 'SHIPPING' && (addressId === '' || escolhida === null)

  return (
    <ClienteForm
      action={fazerPedido}
      slug={slug}
      hidden={{ delivery: modo, addressId: modo === 'SHIPPING' ? addressId : '', quoteToken: modo === 'SHIPPING' ? (escolhida?.quoteToken ?? '') : '', key: chave }}
      submit="Ir para o pagamento"
      disabled={semPagamento || semForma || faltaEscolha}
      className="af-cl-form af-cl-checkout"
    >
      {(estado) => (
        <>
          {semPagamento ? (
            <p role="alert" className="af-cl-notice">
              A loja ainda não recebe pagamento por aqui. Fale com a loja.
            </p>
          ) : null}
          {semForma ? (
            <p role="alert" className="af-cl-notice">
              A loja não está recebendo pedidos agora. Fale com a loja.
            </p>
          ) : (
            <fieldset className="af-cl-fieldset">
              <legend className="af-cl-section">Como receber</legend>
              <div className="af-cl-choices">
                {options.pickup.enabled ? (
                  <ChoiceCard type="radio" name="modo" value="PICKUP" checked={modo === 'PICKUP'} onChange={() => setModo('PICKUP')} title="Retirar na loja" detail={options.pickup.instructions ?? 'Você retira o pedido na loja, sem frete.'} />
                ) : null}
                {entregaLigada ? (
                  <ChoiceCard type="radio" name="modo" value="SHIPPING" checked={modo === 'SHIPPING'} onChange={() => setModo('SHIPPING')} title="Entregar no endereço" detail="Receba em casa. O frete aparece depois de escolher o endereço." />
                ) : null}
              </div>
            </fieldset>
          )}

          {modo === 'SHIPPING' && entregaLigada ? (
            <>
              <fieldset className="af-cl-fieldset">
                <legend className="af-cl-section">Endereço</legend>
                {enderecos.length === 0 ? <p className="af-cl-muted">Você ainda não tem endereço salvo. Cadastre um para calcular o frete.</p> : null}
                <div className="af-cl-choices">
                  {enderecos.map((e) => (
                    <ChoiceCard key={e.id} type="radio" name="enderecoEscolhido" value={e.id} checked={addressId === e.id} onChange={() => setAddressId(e.id)} title={e.label ?? e.recipientName} detail={`${e.street}, ${e.number} · ${e.city} - ${e.state}`} />
                  ))}
                </div>
                <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setNovo(true)}>
                  Novo endereço
                </Button>
              </fieldset>

              {addressId !== '' ? (
                <fieldset className="af-cl-fieldset" aria-busy={carregando}>
                  <legend className="af-cl-section">Frete</legend>
                  {carregando ? <p className="af-cl-muted">Calculando o frete…</p> : null}
                  {cotacao && !cotacao.ok ? (
                    <p role="alert" className="af-cl-notice">
                      {cotacao.message}
                    </p>
                  ) : null}
                  {cotacao?.ok && cotacao.cotacao.options.length === 0 ? (
                    <p role="alert" className="af-cl-notice">
                      {cotacao.cotacao.shippingError ?? 'A entrega não está disponível agora.'}
                    </p>
                  ) : null}
                  {cotacao?.ok && cotacao.cotacao.options.length > 0 ? (
                    <div className="af-cl-choices">
                      {cotacao.cotacao.options.map((o) => (
                        <ChoiceCard key={o.serviceCode} type="radio" name="opcaoFrete" value={o.serviceCode} checked={opcao === o.serviceCode} onChange={() => setOpcao(o.serviceCode)} title={`${o.carrier} · ${o.name}`} detail={`${prazo(o.days)} · ${formatMoney(o.priceCents)}`} />
                      ))}
                    </div>
                  ) : null}
                </fieldset>
              ) : null}
            </>
          ) : null}

          <Field label="Recado" hint="Opcional. A loja lê antes de separar o pedido.">
            <Textarea name="note" maxLength={300} rows={2} defaultValue={estado.values['note'] ?? ''} />
          </Field>

          <section className="af-cl-summary" aria-label="Resumo do pedido">
            <ul className="af-cl-bill">
              {resumo.linhas.map((l) => (
                <li key={l.name} className="af-cl-bill__row">
                  <span>
                    {l.quantity} × {l.name}
                  </span>
                  <span>{formatMoney(l.totalCents)}</span>
                </li>
              ))}
              {modo === 'SHIPPING' ? (
                <li className="af-cl-bill__row">
                  <span>Frete</span>
                  <span>{escolhida ? formatMoney(frete) : 'a calcular'}</span>
                </li>
              ) : null}
              <li className="af-cl-bill__row af-cl-bill__row--total">
                <strong>Total</strong>
                <strong>{formatMoney(resumo.itemsCents + frete)}</strong>
              </li>
            </ul>
          </section>

          <Sheet open={novo} onClose={() => setNovo(false)} title="Novo endereço">
            {novo ? (
              <EnderecoForm
                slug={slug}
                endereco={null}
                nomeInicial={nomeInicial}
                primeiro={enderecos.length === 0}
                onDone={(id) => {
                  setNovo(false)
                  if (id !== '') setAddressId(id)
                }}
              />
            ) : null}
          </Sheet>
        </>
      )}
    </ClienteForm>
  )
}
