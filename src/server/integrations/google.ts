import { createRemoteJWKSet } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { IntegrationError } from './errors'
import { fetchWithTimeout, readJson } from './http'
import type { GoogleGateway } from './index'

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const CHAVES = 'https://www.googleapis.com/oauth2/v3/certs'
const TIMEOUT_MS = 8_000
const SERVICO = 'O Google'

/** Google real: troca o código por `id_token` no endereço de token e confere a assinatura pelas chaves públicas (buscadas e guardadas pelo `jose`). */
export function createGoogleGateway(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): GoogleGateway {
  const doFetch = o.fetch ?? fetch
  let jwks: JWTVerifyGetKey | null = null
  return {
    authorizationEndpoint: () => AUTORIZACAO,
    keys() {
      jwks ??= createRemoteJWKSet(new URL(CHAVES), { timeoutDuration: o.timeoutMs ?? TIMEOUT_MS })
      return jwks
    },
    async exchangeCode(i) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: i.code,
        code_verifier: i.codeVerifier,
        client_id: i.clientId,
        client_secret: i.clientSecret,
        redirect_uri: i.redirectUri,
      })
      const res = await fetchWithTimeout(
        doFetch,
        TOKEN,
        { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() },
        o.timeoutMs ?? TIMEOUT_MS,
        SERVICO,
      )
      if (res.status >= 400 && res.status < 500) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      if (!res.ok) throw new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
      const json = await readJson(res, SERVICO)
      const idToken = typeof json === 'object' && json !== null && 'id_token' in json ? json.id_token : null
      if (typeof idToken !== 'string' || idToken === '') throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      return { idToken }
    },
  }
}
