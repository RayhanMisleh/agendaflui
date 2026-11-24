import type { JWTVerifyGetKey } from 'jose'
import { env } from '@/server/env'
import { fakeFrenet, fakeGoogleAuthority, fakeMercadoPago, fakePostalCodes } from './fakes'
import { createFrenetGateway } from './frenet'
import { createGoogleGateway } from './google'
import { createMercadoPagoGateway } from './mercadopago'
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

export type MpPaymentStatus = 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back'

/** Um pagamento como a consulta ao Mercado Pago o devolve (valor em centavos, já convertido por texto). */
export type MpPayment = {
  id: string
  status: MpPaymentStatus
  statusDetail: string | null
  amountCents: number
  currency: string
  externalReference: string | null
  approvedAt: Date | null
}

export interface MercadoPagoGateway {
  /** Cria a preferência do Checkout Pro. O token é o da conta; nunca vai para log nem para erro. Falha é `IntegrationError`. */
  createPreference(
    accessToken: string,
    p: {
      orderId: string
      items: { id: string; title: string; quantity: number; unitPriceCents: number }[]
      payerEmail: string | null
      notificationUrl: string
      backUrl: string | null
      expiresAt: Date
    },
  ): Promise<{ preferenceId: string; checkoutUrl: string }>
  /** O pagamento como o Mercado Pago o tem agora: a única fonte da situação de um pagamento. */
  getPayment(accessToken: string, paymentId: string): Promise<MpPayment>
  /** Os pagamentos cuja `external_reference` é o pedido. */
  searchPaymentsByReference(accessToken: string, orderId: string): Promise<MpPayment[]>
}

/** As declarações do `id_token` do Google que o login lê. */
export type GoogleIdClaims = {
  iss: string
  aud: string
  sub: string
  exp: number
  iat: number
  email?: string
  email_verified?: boolean
  nonce?: string
  name?: string
}

export interface GoogleGateway {
  /** O endereço da tela de escolha de conta do Google (no modo falso, a tela de simulação do app). */
  authorizationEndpoint(): string
  /** Troca o código (com o `code_verifier` do PKCE) pelo `id_token`. A chave secreta nunca vai para log nem para erro. Falha é `IntegrationError`. */
  exchangeCode(i: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }>
  /** As chaves públicas do Google para conferir a assinatura do `id_token`. */
  keys(): JWTVerifyGetKey
}

export type Integrations = { postalCodes: PostalCodeGateway; frenet: FrenetGateway; mercadoPago: MercadoPagoGateway; google: GoogleGateway }

let override: Partial<Integrations> | null = null
let real: Integrations | null = null
let fake: Integrations | null = null

/** As integrações do modo atual; `setIntegrationsForTests` troca partes só em teste. */
export function integrations(): Integrations {
  const base =
    env.INTEGRATIONS_MODE === 'real'
      ? (real ??= { postalCodes: createViaCepGateway(), frenet: createFrenetGateway(), mercadoPago: createMercadoPagoGateway(), google: createGoogleGateway() })
      : (fake ??= { postalCodes: fakePostalCodes(), frenet: fakeFrenet(), mercadoPago: fakeMercadoPago(), google: fakeGoogleAuthority() })
  return override === null ? base : { ...base, ...override }
}

/** Só para testes: troca as integrações indicadas (as outras seguem como estão); `null` desfaz. */
export function setIntegrationsForTests(i: Partial<Integrations> | null): void {
  override = i
}
