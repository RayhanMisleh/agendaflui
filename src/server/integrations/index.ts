import { env } from '@/server/env'
import { fakePostalCodes } from './fakes'
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

export type Integrations = { postalCodes: PostalCodeGateway }

let override: Partial<Integrations> | null = null
let real: Integrations | null = null
let fake: Integrations | null = null

/** As integrações do modo atual; `setIntegrationsForTests` troca partes só em teste. */
export function integrations(): Integrations {
  const base = env.INTEGRATIONS_MODE === 'real' ? (real ??= { postalCodes: createViaCepGateway() }) : (fake ??= { postalCodes: fakePostalCodes() })
  return override === null ? base : { ...base, ...override }
}

/** Só para testes: troca as integrações indicadas (as outras seguem como estão); `null` desfaz. */
export function setIntegrationsForTests(i: Partial<Integrations> | null): void {
  override = i
}
