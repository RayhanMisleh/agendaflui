import type { PostalCodeGateway } from './index'

/** ViaCEP falsa (desenvolvimento e teste): um endereço fixo para qualquer CEP de 8 dígitos e `null` para `00000000`. */
export function fakePostalCodes(): PostalCodeGateway {
  return {
    async lookup(cep: string) {
      if (cep === '00000000') return null
      return { street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }
    },
  }
}
