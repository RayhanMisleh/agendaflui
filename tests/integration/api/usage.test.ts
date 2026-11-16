import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as business } from '@/app/api/v1/business/route'
import { GET as health } from '@/app/api/v1/health/route'
import { GET as availability } from '@/app/api/v1/availability/route'
import { GET as meAppointments } from '@/app/api/v1/appointments/route'
import { defineRoute } from '@/server/api/define-route'
import { flushUsage, MAX_PENDING_USAGE, recordUsage, usageSummary } from '@/server/api/usage'
import { prisma } from '@/server/db/client'
import { z } from '@/server/domain/errors'
import { addMinutes, fromEpochMs } from '@/server/time'
import { apiRequest, callRoute, makeAppKey } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { domainError } from '../../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../../setup/factories'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

const H0 = fromEpochMs(Date.UTC(2026, 10, 16, 10, 0, 0))
const admin = async () => {
  const a = await makePlatformAdmin()
  return { kind: 'platform_admin' as const, adminId: a.id, name: a.name }
}
const UUID = '5f2c7d0e-1111-4222-8333-444455556666'

let c: Cena

beforeEach(async () => {
  await resetDb()
  await flushUsage()
  c = await montarCena()
})

const linhas = () => prisma.apiUsageHourly.findMany({ orderBy: [{ hour: 'asc' }, { route: 'asc' }] })

describe('recordUsage e flushUsage', () => {
  test('três chamadas e um erro 500 viram uma linha com contagens, soma e máximo', async () => {
    const base = { apiKeyId: c.keyId, businessId: c.business.id, route: 'GET /v1/business' }
    recordUsage({ ...base, ms: 10, error: false, at: addMinutes(H0, 5) })
    recordUsage({ ...base, ms: 30, error: false, at: addMinutes(H0, 20) })
    recordUsage({ ...base, ms: 20, error: false, at: addMinutes(H0, 59) })
    recordUsage({ ...base, ms: 40, error: true, at: addMinutes(H0, 30) })
    expect(await flushUsage()).toBe(1)
    const l = await linhas()
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ count: 4, errorCount: 1, totalMs: 100n, maxMs: 40, route: 'GET /v1/business', businessId: c.business.id })
    expect(l[0]?.hour.getTime()).toBe(H0.getTime())
  })

  test('horas diferentes viram linhas diferentes', async () => {
    const base = { apiKeyId: c.keyId, businessId: c.business.id, route: 'GET /v1/business', ms: 5, error: false }
    recordUsage({ ...base, at: addMinutes(H0, 10) })
    recordUsage({ ...base, at: addMinutes(H0, 70) })
    await flushUsage()
    expect(await linhas()).toHaveLength(2)
  })

  test('dois flushUsage seguidos somam em vez de sobrescrever, e o máximo só sobe', async () => {
    const base = { apiKeyId: c.keyId, businessId: c.business.id, route: 'GET /v1/business', error: false, at: H0 }
    recordUsage({ ...base, ms: 50 })
    await flushUsage()
    recordUsage({ ...base, ms: 10 })
    recordUsage({ ...base, ms: 20, error: true })
    await flushUsage()
    const l = await linhas()
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ count: 3, errorCount: 1, totalMs: 80n, maxMs: 50 })
  })

  test('flushUsage concorrentes não contam em dobro', async () => {
    const base = { apiKeyId: c.keyId, businessId: c.business.id, route: 'GET /v1/business', error: false, at: H0, ms: 7 }
    for (let i = 0; i < 5; i++) recordUsage(base)
    await Promise.all([flushUsage(), flushUsage(), flushUsage()])
    expect((await linhas())[0]).toMatchObject({ count: 5, totalMs: 35n })
  })

  test('sem nada acumulado não grava e devolve 0', async () => {
    expect(await flushUsage()).toBe(0)
    expect(await linhas()).toHaveLength(0)
  })

  test('acima do teto descarta as novas combinações, avisa uma vez e mantém as já acumuladas', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const base = { apiKeyId: c.keyId, businessId: c.business.id, error: false, at: H0, ms: 1 }
    for (let i = 0; i < MAX_PENDING_USAGE + 20; i++) recordUsage({ ...base, route: `GET /v1/r${i}` })
    recordUsage({ ...base, route: 'GET /v1/r0' })
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(await flushUsage()).toBe(MAX_PENDING_USAGE)
    const r0 = await prisma.apiUsageHourly.findFirst({ where: { route: 'GET /v1/r0' } })
    expect(r0?.count).toBe(2)
    aviso.mockRestore()
  }, 120_000)

  test('falha ao gravar perde o lote, não reenfileira e registra só o nome do erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // chave de app inexistente: a FK falha e o lote inteiro cai.
    recordUsage({ apiKeyId: UUID, businessId: null, route: 'GET /v1/business', ms: 1, error: false, at: H0 })
    expect(await flushUsage()).toBe(0)
    expect(erro).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(erro.mock.calls)).not.toContain(UUID)
    expect(await flushUsage()).toBe(0)
    expect(erro).toHaveBeenCalledTimes(1)
    erro.mockRestore()
  })
})

describe('defineRoute registra o uso', () => {
  test('grava o caminho-modelo com o método, nunca o caminho real', async () => {
    const rota = defineRoute({
      method: 'GET',
      path: '/v1/coisas/{id}',
      auth: 'key',
      summary: 'x',
      tag: 'x',
      params: z.object({ id: z.string() }),
      response: z.object({ ok: z.literal(true) }),
      handler: async () => ({ ok: true as const }),
    })
    const r = await callRoute(rota, apiRequest('GET', `/v1/coisas/${UUID}`, { key: c.key }), { id: UUID })
    expect(r.status).toBe(200)
    await flushUsage()
    const l = await linhas()
    expect(l).toHaveLength(1)
    expect(l[0]?.route).toBe('GET /v1/coisas/{id}')
    expect(l.map((x) => x.route).join()).not.toContain(UUID)
    expect(l[0]).toMatchObject({ apiKeyId: c.keyId, businessId: c.business.id, count: 1, errorCount: 0 })
  })

  test('status 500 conta como erro; 401 e 422 não', async () => {
    const quebra = defineRoute({
      method: 'GET',
      path: '/v1/quebra',
      auth: 'key',
      summary: 'x',
      tag: 'x',
      response: z.object({ ok: z.literal(true) }),
      handler: async () => {
        throw new Error('boom')
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await callRoute(quebra, apiRequest('GET', '/v1/quebra', { key: c.key }))).status).toBe(500)
    expect((await callRoute(meAppointments, apiRequest('GET', '/v1/appointments', { key: c.key }))).status).toBe(401)
    expect((await callRoute(availability, apiRequest('GET', '/v1/availability?serviceId=nao-e-uuid', { key: c.key }))).status).toBe(422)
    await flushUsage()
    const por = Object.fromEntries((await linhas()).map((l) => [l.route, l]))
    expect(por['GET /v1/quebra']).toMatchObject({ count: 1, errorCount: 1 })
    expect(por['GET /v1/appointments']).toMatchObject({ count: 1, errorCount: 0 })
    expect(por['GET /v1/availability']).toMatchObject({ count: 1, errorCount: 0 })
    vi.restoreAllMocks()
  })

  test('requisição sem chave válida e rota sem autenticação não gravam métrica', async () => {
    expect((await callRoute(business, apiRequest('GET', '/v1/business', { key: 'afk_a_00000000_' + 'x'.repeat(43) }))).status).toBe(401)
    expect((await callRoute(business, apiRequest('GET', '/v1/business'))).status).toBe(401)
    expect((await callRoute(health, apiRequest('GET', '/v1/health'))).status).toBe(200)
    expect(await flushUsage()).toBe(0)
    expect(await linhas()).toHaveLength(0)
  })

  test('chave de plataforma grava a conta resolvida na requisição; chave de conta, a conta da chave', async () => {
    const outra = await makeBusiness()
    const plat = await makeAppKey(null)
    const r = await callRoute(business, apiRequest('GET', '/v1/business', { key: plat.secret, business: outra.slug }))
    expect(r.status).toBe(200)
    // o cabeçalho X-Business numa chave de conta não muda o dono da métrica.
    await callRoute(business, apiRequest('GET', '/v1/business', { key: c.key, business: outra.slug }))
    await callRoute(business, apiRequest('GET', '/v1/business', { key: c.key }))
    await flushUsage()
    const l = await linhas()
    const daPlat = l.find((x) => x.apiKeyId === plat.id)
    const daConta = l.find((x) => x.apiKeyId === c.keyId)
    expect(daPlat?.businessId).toBe(outra.id)
    expect(daConta?.businessId).toBe(c.business.id)
    expect(daConta?.count).toBe(1)
  })

  test('linha com contas diferentes na mesma hora (chave de plataforma) fica sem conta, na memória e no banco', async () => {
    const base = { apiKeyId: c.keyId, route: 'GET /v1/business', error: false, at: H0, ms: 1 }
    recordUsage({ ...base, businessId: c.business.id })
    recordUsage({ ...base, businessId: null })
    await flushUsage()
    recordUsage({ ...base, businessId: c.business.id })
    await flushUsage()
    const l = await linhas()
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ businessId: null, count: 3 })
  })

  test('recordUsage nunca lança, mesmo com dado inválido', () => {
    expect(() =>
      recordUsage({ apiKeyId: c.keyId, businessId: null, route: 'GET /v1/business', ms: Number.NaN, error: false, at: new Date(Number.NaN) }),
    ).not.toThrow()
  })
})

describe('usageSummary', () => {
  test('agrega por rota no intervalo, com média e máximo, e filtra por chave e conta', async () => {
    const a = await admin()
    const base = { apiKeyId: c.keyId, businessId: c.business.id }
    recordUsage({ ...base, route: 'GET /v1/business', ms: 10, error: false, at: H0 })
    recordUsage({ ...base, route: 'GET /v1/business', ms: 30, error: true, at: addMinutes(H0, 120) })
    recordUsage({ ...base, route: 'GET /v1/services', ms: 8, error: false, at: H0 })
    recordUsage({ ...base, route: 'GET /v1/services', ms: 8, error: false, at: addMinutes(H0, 60 * 24 * 10) })
    await flushUsage()
    const q = { from: H0, to: addMinutes(H0, 60 * 24) }
    expect(await usageSummary(a, q)).toEqual([
      { route: 'GET /v1/business', count: 2, errorCount: 1, avgMs: 20, maxMs: 30 },
      { route: 'GET /v1/services', count: 1, errorCount: 0, avgMs: 8, maxMs: 8 },
    ])
    expect(await usageSummary(a, { ...q, businessId: UUID })).toEqual([])
    expect((await usageSummary(a, { ...q, apiKeyId: c.keyId })).length).toBe(2)
  })

  test('exige admin da plataforma em execução', async () => {
    const falso = { kind: 'system' } as unknown as Parameters<typeof usageSummary>[0]
    expect((await domainError(usageSummary(falso, { from: H0, to: addMinutes(H0, 60) }))).code).toBe('forbidden')
  })

  test('limita o intervalo a 92 dias e recusa intervalo invertido', async () => {
    const a = await admin()
    expect((await domainError(usageSummary(a, { from: H0, to: addMinutes(H0, 60 * 24 * 93) }))).code).toBe('validation')
    expect((await domainError(usageSummary(a, { from: addMinutes(H0, 60), to: H0 }))).code).toBe('validation')
    await expect(usageSummary(a, { from: H0, to: addMinutes(H0, 60 * 24 * 92) })).resolves.toEqual([])
  })
})
