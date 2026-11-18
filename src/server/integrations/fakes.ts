import { IntegrationError, type IntegrationErrorCode } from './errors'
import type { FrenetGateway, MercadoPagoGateway, MpPayment, PostalCodeGateway } from './index'

/** ViaCEP falsa (desenvolvimento e teste): um endereço fixo para qualquer CEP de 8 dígitos e `null` para `00000000`. */
export function fakePostalCodes(): PostalCodeGateway {
  return {
    async lookup(cep: string) {
      if (cep === '00000000') return null
      return { street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }
    },
  }
}

/** Frenet falsa (desenvolvimento e teste): PAC (R$ 21,50, 7 dias) e SEDEX (R$ 38,90, 3 dias) para qualquer envio. */
export function fakeFrenet(): FrenetGateway {
  return {
    async quote() {
      return [
        { serviceCode: 'PAC', name: 'PAC', carrier: 'Correios', priceCents: 2150, days: 7 },
        { serviceCode: 'SEDEX', name: 'SEDEX', carrier: 'Correios', priceCents: 3890, days: 3 },
      ]
    },
  }
}

type FakeCall = { method: 'createPreference' | 'getPayment' | 'searchPaymentsByReference'; accessToken: string }
type FakePreference = Parameters<MercadoPagoGateway['createPreference']>[1] & { accessToken: string; preferenceId: string }

/** Mercado Pago falso: guarda as preferências criadas e os pagamentos "registrados" e anota cada chamada (com o token usado). */
export type FakeMercadoPago = MercadoPagoGateway & {
  readonly calls: FakeCall[]
  readonly preferences: FakePreference[]
  /** Faz o Mercado Pago "saber" deste pagamento. `searchableAs` o mostra na busca de outra referência (teste de referência trocada). */
  registerPayment(p: MpPayment, o?: { searchableAs?: string }): void
  /** Enquanto definido, toda chamada falha com este tipo de erro; `null` volta ao normal. */
  failWith(code: IntegrationErrorCode | null): void
}

export function fakeMercadoPago(): FakeMercadoPago {
  const calls: FakeCall[] = []
  const preferences: FakePreference[] = []
  const payments = new Map<string, { payment: MpPayment; searchableAs: string | null }>()
  let failure: IntegrationErrorCode | null = null
  const enter = (method: FakeCall['method'], accessToken: string): void => {
    calls.push({ method, accessToken })
    if (failure !== null) throw new IntegrationError(failure, 'O Mercado Pago está fora do ar (falso).')
  }
  return {
    calls,
    preferences,
    registerPayment(payment, o = {}) {
      payments.set(payment.id, { payment, searchableAs: o.searchableAs ?? null })
    },
    failWith(code) {
      failure = code
    },
    async createPreference(accessToken, p) {
      enter('createPreference', accessToken)
      const preferenceId = `fake-pref-${preferences.length + 1}`
      preferences.push({ ...p, accessToken, preferenceId })
      return { preferenceId, checkoutUrl: `https://mercadopago.fake/checkout/${preferenceId}` }
    },
    async getPayment(accessToken, paymentId) {
      enter('getPayment', accessToken)
      const found = payments.get(paymentId)
      if (found === undefined) throw new IntegrationError('rejected', 'O Mercado Pago não conhece este pagamento (falso).')
      return found.payment
    },
    async searchPaymentsByReference(accessToken, orderId) {
      enter('searchPaymentsByReference', accessToken)
      return [...payments.values()].filter((x) => (x.searchableAs ?? x.payment.externalReference) === orderId).map((x) => x.payment)
    },
  }
}

/** O `gw` é o Mercado Pago falso (e não o real)? É a trava do "Simular pagamento aprovado". */
export function isFakeMercadoPago(gw: MercadoPagoGateway): gw is FakeMercadoPago {
  return 'registerPayment' in gw && typeof gw.registerPayment === 'function'
}
