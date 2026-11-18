import { env } from '@/server/env'
import { fakeFrenet, fakePostalCodes } from './fakes'
import { createFrenetGateway } from './frenet'
import { createViaCepGateway } from './viacep'

export { IntegrationError } from './errors'

/*
 * Serviços externos atrás de interfaces. Todo código do sistema chama `integrations()`, nunca `fetch` direto: em teste e em
 * desenvolvimento vale a implementação falsa (`INTEGRATIONS_MODE=fake`), em produção a real. Nenhum teste toca a rede.
 */

export type PostalCodeAddress = { street: string; district: string; city: string; state: string }

export interface PostalCodeGateway {
  /** Endereço do CEP (8 dígitos); `null` se o CEP não existe. Falha do serviço é `IntegrationError`. */
  lookup(cep: string): Promise<PostalCodeAddress | null>
}

/** Uma cotação de frete: o serviço da transportadora, o preço em centavos e o prazo em dias. */
export type FrenetService = { serviceCode: string; name: string; carrier: string; priceCents: number; days: number }

export type FrenetQuote = {
  sellerCep: string
  recipientCep: string
  invoiceValueCents: number
  items: { sku: string; quantity: number; weightKg: number; lengthCm: number; heightCm: number; widthCm: number }[]
}

export interface FrenetGateway {
  /** Serviços disponíveis para o envio; lista vazia se nenhum atende. Falha do serviço é `IntegrationError`. O token vai só no cabeçalho. */
  quote(token: string, q: FrenetQuote): Promise<FrenetService[]>
}

export type Integrations = { postalCodes: PostalCodeGateway; frenet: FrenetGateway }

let override: Partial<Integrations> | null = null
let real: Integrations | null = null
let fake: Integrations | null = null

/** As integrações do modo atual; `setIntegrationsForTests` troca partes só em teste. */
export function integrations(): Integrations {
  const base =
    env.INTEGRATIONS_MODE === 'real'
      ? (real ??= { postalCodes: createViaCepGateway(), frenet: createFrenetGateway() })
      : (fake ??= { postalCodes: fakePostalCodes(), frenet: fakeFrenet() })
  return override === null ? base : { ...base, ...override }
}

/** Só para testes: troca as integrações indicadas (as outras seguem como estão); `null` desfaz. */
export function setIntegrationsForTests(i: Partial<Integrations> | null): void {
  override = i
}
