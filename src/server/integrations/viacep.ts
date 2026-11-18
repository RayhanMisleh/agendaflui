import { IntegrationError } from './errors'
import { fetchWithTimeout, readJson } from './http'
import type { PostalCodeAddress, PostalCodeGateway } from './index'

const TIMEOUT_MS = 5_000
const SERVICO = 'A consulta de CEP'

function text(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null
}

/** ViaCEP real: `GET https://viacep.com.br/ws/<cep>/json/`. `{"erro": true}` é CEP que não existe (`null`). */
export function createViaCepGateway(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): PostalCodeGateway {
  const doFetch = o.fetch ?? fetch
  return {
    async lookup(cep: string): Promise<PostalCodeAddress | null> {
      const res = await fetchWithTimeout(doFetch, `https://viacep.com.br/ws/${cep}/json/`, { headers: { accept: 'application/json' } }, o.timeoutMs ?? TIMEOUT_MS, SERVICO)
      if (res.status >= 500 || res.status === 429) throw new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
      if (!res.ok) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      const body = await readJson(res, SERVICO)
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      const campos: Record<string, unknown> = { ...body }
      if (campos.erro === true || campos.erro === 'true') return null
      // Rua e bairro vêm vazios em CEP de cidade pequena; os campos de cidade e UF são obrigatórios.
      const street = campos.logradouro === undefined ? '' : text(campos.logradouro)
      const district = campos.bairro === undefined ? '' : text(campos.bairro)
      const city = text(campos.localidade)
      const state = text(campos.uf)
      if (street === null || district === null || city === null || city === '' || state === null || !/^[A-Za-z]{2}$/.test(state)) {
        throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      }
      return { street, district, city, state: state.toUpperCase() }
    },
  }
}
