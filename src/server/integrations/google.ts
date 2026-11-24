import { createRemoteJWKSet } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import type { CalendarEventBody } from '@/server/calendar/event'
import { IntegrationError } from './errors'
import { fetchWithTimeout, readJson } from './http'
import type { GoogleGateway } from './index'

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOGAR = 'https://oauth2.googleapis.com/revoke'
const CHAVES = 'https://www.googleapis.com/oauth2/v3/certs'
const EVENTOS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TIMEOUT_MS = 8_000
const SERVICO = 'O Google'

const RAZOES_DE_LIMITE = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'])
const RAZOES_DE_ACESSO = new Set(['insufficientPermissions', 'forbidden', 'authError'])

/** O motivo (`error.errors[0].reason`) ou o código (`error`) da resposta de erro do Google, sem repassar texto dela. */
async function motivoDoErro(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as unknown
    if (typeof json !== 'object' || json === null || !('error' in json)) return null
    const erro = json.error
    if (typeof erro === 'string') return erro
    if (typeof erro === 'object' && erro !== null && 'errors' in erro && Array.isArray(erro.errors)) {
      const primeiro: unknown = erro.errors[0]
      if (typeof primeiro === 'object' && primeiro !== null && 'reason' in primeiro && typeof primeiro.reason === 'string') return primeiro.reason
    }
    return null
  } catch {
    return null
  }
}

/** Erro de uma resposta da API da agenda: 401 e permissão retirada = `revoked`; limite = `rate_limited`; 5xx = `unavailable`. */
async function erroDaAgenda(res: Response): Promise<IntegrationError> {
  const s = res.status
  if (s === 401) return new IntegrationError('revoked', `${SERVICO} recusou o acesso à agenda.`)
  if (s === 429) return new IntegrationError('rate_limited', `${SERVICO} limitou os pedidos.`)
  if (s >= 500) return new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
  if (s === 403) {
    const motivo = await motivoDoErro(res)
    if (motivo !== null && RAZOES_DE_LIMITE.has(motivo)) return new IntegrationError('rate_limited', `${SERVICO} limitou os pedidos.`)
    if (motivo === null) return new IntegrationError('unavailable', `${SERVICO} respondeu de forma ilegível.`)
    if (RAZOES_DE_ACESSO.has(motivo)) return new IntegrationError('revoked', `${SERVICO} recusou o acesso à agenda.`)
  }
  return new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
}

/** Google real: troca o código por `id_token` no endereço de token e confere a assinatura pelas chaves públicas (buscadas e guardadas pelo `jose`). */
export function createGoogleGateway(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): GoogleGateway {
  const doFetch = o.fetch ?? fetch
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS
  let jwks: JWTVerifyGetKey | null = null
  const chamar = (url: string, init: RequestInit): Promise<Response> => fetchWithTimeout(doFetch, url, init, timeoutMs, SERVICO, true)
  const evento = (accessToken: string, metodo: 'PUT' | 'POST', url: string, event: CalendarEventBody): Promise<Response> =>
    chamar(url, {
      method: metodo,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(event),
    })
  return {
    authorizationEndpoint: () => AUTORIZACAO,
    keys() {
      jwks ??= createRemoteJWKSet(new URL(CHAVES), { timeoutDuration: timeoutMs })
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
      const res = await chamar(TOKEN, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (res.status >= 400 && res.status < 500) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      if (!res.ok) throw new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
      const json = await readJson(res, SERVICO)
      const campo = (nome: string): unknown => (typeof json === 'object' && json !== null && nome in json ? (json as Record<string, unknown>)[nome] : null)
      const idToken = campo('id_token')
      if (typeof idToken !== 'string' || idToken === '') throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      const refresh = campo('refresh_token')
      const scope = campo('scope')
      return {
        idToken,
        refreshToken: typeof refresh === 'string' && refresh !== '' ? refresh : null,
        scope: typeof scope === 'string' ? scope : null,
      }
    },
    async refreshAccessToken(i) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: i.refreshToken,
        client_id: i.clientId,
        client_secret: i.clientSecret,
      })
      const res = await chamar(TOKEN, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (res.status === 400 || res.status === 401) {
        const motivo = await motivoDoErro(res)
        if (motivo === 'invalid_grant') throw new IntegrationError('revoked', `${SERVICO} recusou o acesso à agenda.`)
        throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      }
      if (res.status === 429) throw new IntegrationError('rate_limited', `${SERVICO} limitou os pedidos.`)
      if (res.status >= 500) throw new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
      if (!res.ok) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      const json = await readJson(res, SERVICO)
      const token = typeof json === 'object' && json !== null && 'access_token' in json ? json.access_token : null
      if (typeof token !== 'string' || token === '') throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      return { accessToken: token }
    },
    async upsertEvent({ accessToken, event }) {
      const porId = `${EVENTOS}/${encodeURIComponent(event.id)}`
      let res = await evento(accessToken, 'PUT', porId, event)
      if (res.status === 404) {
        res = await evento(accessToken, 'POST', EVENTOS, event)
        // Outro envio criou o mesmo id agora mesmo: atualiza pelo id, uma vez.
        if (res.status === 409) res = await evento(accessToken, 'PUT', porId, event)
      }
      if (!res.ok) throw await erroDaAgenda(res)
    },
    async deleteEvent({ accessToken, eventId }) {
      const res = await chamar(`${EVENTOS}/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } })
      if (res.ok || res.status === 404 || res.status === 410) return
      throw await erroDaAgenda(res)
    },
    async revokeToken(token) {
      try {
        await chamar(REVOGAR, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        })
      } catch {
        // Melhor esforço: o token pode já estar morto, e quem chama já fez o que dependia dele.
      }
    },
  }
}
