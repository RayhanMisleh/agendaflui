import { describe, expect, test } from 'vitest'
import { buildCalendarEvent } from '@/server/calendar/event'
import { IntegrationError } from '@/server/integrations'
import { createGoogleGateway } from '@/server/integrations/google'

const EVENTO = buildCalendarEvent(
  {
    id: '0f3c2a9e-7b1d-4c8e-9a52-3d6e1f0b8c47',
    status: 'CONFIRMED',
    startsAt: new Date('2026-11-26T17:00:00.000Z'),
    endsAt: new Date('2026-11-26T18:00:00.000Z'),
    customerName: 'Marina',
    customerNote: null,
    petLabel: null,
    serviceNames: ['Banho'],
  },
  { timeZone: 'America/Sao_Paulo', painelUrl: 'https://app.exemplo.test/painel/agenda' },
)

type Chamada = { method: string; url: string; body: string | null; auth: string | null }

/** `fetch` falso que responde na ordem e anota o que recebeu. */
function falso(respostas: { status: number; json?: unknown }[]) {
  const chamadas: Chamada[] = []
  let i = 0
  const doFetch: typeof fetch = async (url, init) => {
    chamadas.push({
      method: String(init?.method ?? 'GET'),
      url: String(url),
      body: typeof init?.body === 'string' ? init.body : null,
      auth: new Headers(init?.headers).get('authorization'),
    })
    const r = respostas[Math.min(i++, respostas.length - 1)] ?? { status: 200 }
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { gateway: createGoogleGateway({ fetch: doFetch, timeoutMs: 500 }), chamadas }
}

const codigo = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof IntegrationError ? e.code : 'outro'),
  )

describe('eventos', () => {
  test('PUT 404 → POST com o mesmo id', async () => {
    const { gateway, chamadas } = falso([{ status: 404, json: { error: { code: 404 } } }, { status: 200, json: {} }])
    await gateway.upsertEvent({ accessToken: 'tok', event: EVENTO })
    expect(chamadas.map((c) => c.method)).toEqual(['PUT', 'POST'])
    expect(chamadas[0]?.url).toBe(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${EVENTO.id}`)
    expect(chamadas[1]?.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect((JSON.parse(chamadas[1]?.body ?? '{}') as { id: string }).id).toBe(EVENTO.id)
    expect(chamadas[1]?.auth).toBe('Bearer tok')
  })

  test('POST 409 (o id já existe) → PUT de novo uma vez', async () => {
    const { gateway, chamadas } = falso([{ status: 404 }, { status: 409 }, { status: 200, json: {} }])
    await gateway.upsertEvent({ accessToken: 'tok', event: EVENTO })
    expect(chamadas.map((c) => c.method)).toEqual(['PUT', 'POST', 'PUT'])
  })

  test('DELETE 410 e 404 → resolve', async () => {
    for (const status of [410, 404, 204]) {
      const { gateway } = falso([{ status }])
      await expect(gateway.deleteEvent({ accessToken: 'tok', eventId: EVENTO.id })).resolves.toBeUndefined()
    }
  })

  test('403 userRateLimitExceeded e 429 → rate_limited', async () => {
    const limite = { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }
    expect(await codigo(falso([{ status: 403, json: limite }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }))).toBe('rate_limited')
    expect(await codigo(falso([{ status: 429 }]).gateway.deleteEvent({ accessToken: 't', eventId: 'x' }))).toBe('rate_limited')
  })

  test('401 e 403 insufficientPermissions → revoked', async () => {
    const sem = { error: { errors: [{ reason: 'insufficientPermissions' }] } }
    expect(await codigo(falso([{ status: 401 }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }))).toBe('revoked')
    expect(await codigo(falso([{ status: 403, json: sem }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }))).toBe('revoked')
  })

  test('503 → unavailable e outro 4xx → rejected', async () => {
    expect(await codigo(falso([{ status: 503 }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }))).toBe('unavailable')
    expect(await codigo(falso([{ status: 400, json: { error: { message: 'dado do cliente' } } }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }))).toBe('rejected')
  })
})

describe('token', () => {
  const PEDIDO = { clientId: 'id', clientSecret: 'segredo', refreshToken: 'rt-x' }

  test('refresh com 400 invalid_grant → revoked; com 200 devolve o token de acesso', async () => {
    expect(await codigo(falso([{ status: 400, json: { error: 'invalid_grant' } }]).gateway.refreshAccessToken(PEDIDO))).toBe('revoked')
    const { gateway } = falso([{ status: 200, json: { access_token: 'acesso', expires_in: 3600 } }])
    expect(await gateway.refreshAccessToken(PEDIDO)).toEqual({ accessToken: 'acesso' })
  })

  test('troca de código devolve o token de renovação e o escopo', async () => {
    const { gateway } = falso([{ status: 200, json: { id_token: 'a.b.c', refresh_token: 'rt', scope: 'openid email' } }])
    const r = await gateway.exchangeCode({ clientId: 'i', clientSecret: 's', code: 'c', codeVerifier: 'v', redirectUri: 'https://x.test/r' })
    expect(r).toEqual({ idToken: 'a.b.c', refreshToken: 'rt', scope: 'openid email' })
    const sem = falso([{ status: 200, json: { id_token: 'a.b.c' } }])
    expect(await sem.gateway.exchangeCode({ clientId: 'i', clientSecret: 's', code: 'c', codeVerifier: 'v', redirectUri: 'https://x.test/r' })).toEqual({
      idToken: 'a.b.c',
      refreshToken: null,
      scope: null,
    })
  })

  test('revokeToken engole a falha', async () => {
    const { gateway, chamadas } = falso([{ status: 500 }])
    await expect(gateway.revokeToken('rt-x')).resolves.toBeUndefined()
    expect(chamadas[0]?.url).toBe('https://oauth2.googleapis.com/revoke')
  })

  test('nenhuma mensagem de erro traz o corpo da resposta', async () => {
    const segredo = 'DADO-DO-CLIENTE-NO-CORPO'
    const casos = [
      falso([{ status: 400, json: { error: { message: segredo } } }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }),
      falso([{ status: 503, json: { error: { message: segredo } } }]).gateway.upsertEvent({ accessToken: 't', event: EVENTO }),
      falso([{ status: 401, json: { error: { message: segredo } } }]).gateway.deleteEvent({ accessToken: 't', eventId: 'x' }),
      falso([{ status: 400, json: { error: 'invalid_grant', error_description: segredo } }]).gateway.refreshAccessToken(PEDIDO),
    ]
    for (const c of casos) {
      const erro = await c.then(
        () => null,
        (e: unknown) => e,
      )
      expect(erro).toBeInstanceOf(IntegrationError)
      expect((erro as Error).message).not.toContain(segredo)
    }
  })
})
