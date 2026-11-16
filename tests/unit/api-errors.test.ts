import { AuthError } from '@/server/auth/actor'
import { errorResponse } from '@/server/api/errors'
import { ApiAuthError } from '@/server/domain/platform/api-keys'
import { DomainError, z } from '@/server/domain/errors'
import { fromEpochMs } from '@/server/time'
import { apiError } from '../setup/api'

const req = new Request('http://api.localhost:3000/v1/x', { method: 'POST', headers: { authorization: 'Bearer segredo', 'x-app-key': 'afk_a_00000000_segredo' } })

async function corpo(res: Response): Promise<unknown> {
  return res.json()
}

describe('errorResponse', () => {
  test.each([
    ['validation', 422],
    ['not_found', 404],
    ['forbidden', 403],
    ['conflict', 409],
    ['module_disabled', 404],
    ['business_unavailable', 503],
  ] as const)('DomainError %s vira status %i com o formato padrão', async (code, status) => {
    const res = errorResponse(new DomainError(code, 'Mensagem clara.'), req)
    expect(res.status).toBe(status)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(apiError(await corpo(res))).toEqual({ code, message: 'Mensagem clara.' })
  })

  test('reason, fields e details passam; datas em details saem em ISO', async () => {
    const e = new DomainError('conflict', 'Horário ocupado.', {
      reason: 'slot_taken',
      fields: { startsAt: 'Escolha outro horário.' },
      details: { startsAt: fromEpochMs(1_800_000_000_000), outros: [1n] },
    })
    const body = apiError(await corpo(errorResponse(e, req)))
    expect(body).toEqual({
      code: 'conflict',
      reason: 'slot_taken',
      message: 'Horário ocupado.',
      fields: { startsAt: 'Escolha outro horário.' },
      details: { startsAt: '2027-01-15T08:00:00.000Z', outros: [1] },
    })
  })

  test('ApiAuthError: unauthorized 401, forbidden 403, business_unavailable 503, com reason', async () => {
    for (const [code, status] of [['unauthorized', 401], ['forbidden', 403], ['business_unavailable', 503]] as const) {
      const res = errorResponse(new ApiAuthError(code, 'motivo_x', 'Texto.'), req)
      expect(res.status).toBe(status)
      expect(apiError(await corpo(res))).toEqual({ code, reason: 'motivo_x', message: 'Texto.' })
    }
  })

  test('AuthError de limite vira 429 com Retry-After inteiro', async () => {
    const res = errorResponse(new AuthError('rate_limited', 42), req)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(apiError(await corpo(res)).code).toBe('rate_limited')
  })

  test('erro do Zod vira 422 com campos por caminho; chave desconhecida aponta o nome do campo', async () => {
    const schema = z.strictObject({ nome: z.string(), itens: z.array(z.strictObject({ qtd: z.number() })) })
    const r = schema.safeParse({ nome: 1, itens: [{ qtd: 'x', extra: 1 }], solto: true })
    if (r.success) throw new Error('era para falhar')
    const res = errorResponse(r.error, req)
    expect(res.status).toBe(422)
    const body = apiError(await corpo(res))
    expect(body.code).toBe('validation')
    expect(Object.keys(body.fields ?? {}).sort()).toEqual(['itens.0.extra', 'itens.0.qtd', 'nome', 'solto'])
  })

  test('erro do Zod na raiz usa o campo "_"', async () => {
    const r = z.object({ a: z.string() }).safeParse(null)
    if (r.success) throw new Error('era para falhar')
    expect(Object.keys(apiError(await corpo(errorResponse(r.error, req))).fields ?? {})).toEqual(['_'])
  })

  test('erro qualquer vira 500 genérico, sem a mensagem original, e registra só o permitido', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const res = errorResponse(new Error('senha=hunter2'), req, { requestId: 'req-1', route: '/v1/x/{id}' })
      expect(res.status).toBe(500)
      expect(res.headers.get('x-request-id')).toBe('req-1')
      const texto = JSON.stringify(await corpo(res))
      expect(texto).not.toContain('hunter2')
      expect(apiError(JSON.parse(texto)).code).toBe('internal')
      const gravado = log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(gravado).toContain('req-1')
      expect(gravado).toContain('/v1/x/{id}')
      expect(gravado).toContain('POST')
      expect(gravado).toContain('hunter2')
      expect(gravado).not.toContain('segredo')
      expect(gravado).not.toContain('afk_a_')
    } finally {
      log.mockRestore()
    }
  })

  test('valor lançado que não é Error também vira 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const res = errorResponse('texto solto', req)
      expect(res.status).toBe(500)
    } finally {
      log.mockRestore()
    }
  })
})

describe('errorResponse nunca lança', () => {
  test('details que não serializa: 500 internal padrão com X-Request-Id, e o motivo vai para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const res = errorResponse(new DomainError('conflict', 'Conflito.', { details: { mapa: new Map() } }), req, { requestId: 'req-9' })
      expect(res.status).toBe(500)
      expect(res.headers.get('x-request-id')).toBe('req-9')
      expect(apiError(await res.json()).code).toBe('internal')
      expect(log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('req-9')
    } finally {
      log.mockRestore()
    }
  })
})
