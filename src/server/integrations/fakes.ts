import type { FrenetGateway, PostalCodeGateway } from './index'

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
