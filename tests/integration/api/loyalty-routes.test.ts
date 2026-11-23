import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as obterMe } from '@/app/api/v1/loyalty/me/route'
import { GET as obterExtrato } from '@/app/api/v1/loyalty/me/statement/route'
import { GET as listarPremios } from '@/app/api/v1/loyalty/prizes/route'
import { GET as obterRanking } from '@/app/api/v1/loyalty/ranking/route'
import { POST as cancelar } from '@/app/api/v1/loyalty/redemptions/[id]/cancel/route'
import { GET as listarResgates, POST as resgatar } from '@/app/api/v1/loyalty/redemptions/route'
import { prisma } from '@/server/db/client'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { updateLoyaltySettings, getLoyaltySettings } from '@/server/domain/loyalty/settings'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'
import { lancar, saldoNoBanco } from '../../setup/loyalty'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena
let premio: { id: string }

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { loyalty: true } })
  const dono = await makeCtx(c.business)
  premio = await createPrize(dono, { name: 'Corte grátis', description: 'Um corte', costPoints: 100, stock: 5, active: true })
})

const get = (h: Parameters<typeof callRoute>[0], path: string, token?: string) =>
  callRoute(h, apiRequest('GET', path, { business: c.business.slug, ...(token ? { token } : {}) }))
const post = (h: Parameters<typeof callRoute>[0], path: string, body: unknown, o: { token?: string; headers?: Record<string, string>; params?: Record<string, string> } = {}) =>
  callRoute(h, apiRequest('POST', path, { business: c.business.slug, ...(o.token ? { token: o.token } : {}), body, ...(o.headers ? { headers: o.headers } : {}) }), o.params ?? {})

describe('módulo desligado', () => {
  test('todas as rotas respondem 404 module_disabled, antes de validar o corpo', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { loyalty: false } })
    const t = c.tokenCliente
    const respostas = [
      await get(obterMe, '/v1/loyalty/me', t),
      await get(obterExtrato, '/v1/loyalty/me/statement', t),
      await get(listarPremios, '/v1/loyalty/prizes'),
      await get(obterRanking, '/v1/loyalty/ranking'),
      await get(listarResgates, '/v1/loyalty/redemptions', t),
      await post(resgatar, '/v1/loyalty/redemptions', { lixo: 1 }, { token: t }),
      await post(cancelar, '/v1/loyalty/redemptions/x/cancel', undefined, { token: t, params: { id: 'nao-uuid' } }),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(404)
      expect(apiError(r.json).code).toBe('module_disabled')
    }
  })
})

describe('GET /v1/loyalty/me e extrato', () => {
  test('saldo, clube e rótulos dos termos', async () => {
    await lancar(c.business.id, c.socio.id, 70)
    const r = await get(obterMe, '/v1/loyalty/me', c.tokenSocio)
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ balance: 70, clubMember: true, terms: { points: { singular: expect.any(String), plural: expect.any(String) }, club: expect.any(String) } })
    expect(jsonObject((await get(obterMe, '/v1/loyalty/me', c.tokenCliente)).json)).toMatchObject({ balance: 0, clubMember: false })
  })

  test('exige login de cliente', async () => {
    expect((await get(obterMe, '/v1/loyalty/me')).status).toBe(401)
  })

  test('extrato por cursor, só do próprio cliente', async () => {
    for (let i = 1; i <= 3; i++) await lancar(c.business.id, c.cliente.id, i, { createdAt: new Date(Date.now() - (4 - i) * 60_000) })
    await lancar(c.business.id, c.outro.id, 99)
    const p1 = jsonObject((await get(obterExtrato, '/v1/loyalty/me/statement?limit=2', c.tokenCliente)).json)
    expect((p1.items as { points: number }[]).map((i) => i.points)).toEqual([3, 2])
    const p2 = jsonObject((await get(obterExtrato, `/v1/loyalty/me/statement?limit=2&cursor=${encodeURIComponent(p1.nextCursor as string)}`, c.tokenCliente)).json)
    expect((p2.items as { points: number }[]).map((i) => i.points)).toEqual([1])
    expect(p2.nextCursor).toBeNull()
    expect(Object.keys((p1.items as object[])[0] ?? {}).sort()).toEqual(['appointmentId', 'createdAt', 'createdLabel', 'id', 'kind', 'points', 'reason', 'redemptionId'])
  })
})

describe('GET /v1/loyalty/prizes', () => {
  test('visitante vê os prêmios ativos com estoque, sem o número do estoque', async () => {
    const dono = await makeCtx(c.business)
    await createPrize(dono, { name: 'Esgotado', description: null, costPoints: 10, stock: 0, active: true })
    await createPrize(dono, { name: 'Inativo', description: null, costPoints: 10, stock: null, active: false })
    const r = await get(listarPremios, '/v1/loyalty/prizes')
    expect(r.status).toBe(200)
    const itens = jsonObject(r.json).items as Record<string, unknown>[]
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ id: premio.id, name: 'Corte grátis', description: 'Um corte', costPoints: 100, imageUrl: null, available: true })
    expect(itens[0]).not.toHaveProperty('stock')
    expect(r.text).not.toContain('"stock"')
  })

  test('com login de cliente também funciona', async () => {
    expect((await get(listarPremios, '/v1/loyalty/prizes', c.tokenCliente)).status).toBe(200)
  })
})

describe('POST /v1/loyalty/redemptions', () => {
  test('201 no primeiro, 200 na repetição com a mesma chave, e um débito só', async () => {
    await lancar(c.business.id, c.cliente.id, 300)
    const h = { 'idempotency-key': 'abc-123' }
    const a = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente, headers: h })
    expect(a.status).toBe(201)
    const corpoA = jsonObject(a.json)
    expect(corpoA).toMatchObject({ balance: 200, redemption: { status: 'PENDING', costPoints: 100, prize: { id: premio.id, name: 'Corte grátis' } } })
    const b = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente, headers: h })
    expect(b.status).toBe(200)
    expect((jsonObject(b.json).redemption as { id: string }).id).toBe((corpoA.redemption as { id: string }).id)
    expect(await saldoNoBanco(c.business.id, c.cliente.id)).toBe(200)
  })

  test('mesma chave com outro prêmio: 409 idempotency_key_reused', async () => {
    await lancar(c.business.id, c.cliente.id, 300)
    const dono = await makeCtx(c.business)
    const outro = await createPrize(dono, { name: 'Outro', description: null, costPoints: 10, stock: null, active: true })
    const h = { 'idempotency-key': 'k1' }
    await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente, headers: h })
    const r = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: outro.id }, { token: c.tokenCliente, headers: h })
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toMatchObject({ code: 'conflict', reason: 'idempotency_key_reused' })
  })

  test('sem saldo: 409 insufficient_points e nada gravado', async () => {
    const r = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente })
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toMatchObject({ code: 'conflict', reason: 'insufficient_points' })
    expect(await prisma.prizeRedemption.count()).toBe(0)
  })

  test('sem estoque: 409 out_of_stock; prêmio desconhecido: 404; corpo com campo a mais: 422; sem login: 401', async () => {
    await lancar(c.business.id, c.cliente.id, 300)
    await prisma.prize.update({ where: { id: premio.id }, data: { stock: 0 } })
    expect(apiError((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente })).json).reason).toBe('out_of_stock')
    expect((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: '0b8e2f47-3d19-4a5c-8e60-71c2d9a4f3b8' }, { token: c.tokenCliente })).status).toBe(404)
    expect((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id, deliverNow: true }, { token: c.tokenCliente })).status).toBe(422)
    expect((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, {})).status).toBe(401)
  })

  test('o cliente da conta B não resgata o prêmio da conta A (404)', async () => {
    const outra = await montarCena()
    await prisma.businessModules.update({ where: { businessId: outra.business.id }, data: { loyalty: true } })
    await lancar(outra.business.id, outra.cliente.id, 1000)
    const r = await callRoute(resgatar, apiRequest('POST', '/v1/loyalty/redemptions', { business: outra.business.slug, token: outra.tokenCliente, body: { prizeId: premio.id } }))
    expect(r.status).toBe(404)
    expect(await saldoNoBanco(outra.business.id, outra.cliente.id)).toBe(1000)
  })

  test('limite de 10 por minuto por pessoa: o 11º pedido é 429', async () => {
    const codigos: number[] = []
    for (let i = 0; i < 11; i++) codigos.push((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente })).status)
    expect(codigos.slice(0, 10).every((s) => s === 409)).toBe(true)
    expect(codigos[10]).toBe(429)
    const outro = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenOutro })
    expect(outro.status).toBe(409)
  })
})

describe('resgates do cliente', () => {
  test('lista só os próprios e cancela o próprio, devolvendo os pontos', async () => {
    await lancar(c.business.id, c.cliente.id, 200)
    await lancar(c.business.id, c.outro.id, 200)
    const a = jsonObject((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenCliente })).json)
    const b = jsonObject((await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id }, { token: c.tokenOutro })).json)
    const lista = jsonObject((await get(listarResgates, '/v1/loyalty/redemptions', c.tokenCliente)).json)
    expect((lista.items as { id: string }[]).map((i) => i.id)).toEqual([(a.redemption as { id: string }).id])
    expect(lista.nextCursor).toBeNull()
    const idB = (b.redemption as { id: string }).id
    const alheio = await post(cancelar, `/v1/loyalty/redemptions/${idB}/cancel`, undefined, { token: c.tokenCliente, params: { id: idB } })
    expect(alheio.status).toBe(404)
    const idA = (a.redemption as { id: string }).id
    const ok = await post(cancelar, `/v1/loyalty/redemptions/${idA}/cancel`, undefined, { token: c.tokenCliente, params: { id: idA } })
    expect(ok.status).toBe(200)
    expect(jsonObject(ok.json)).toMatchObject({ id: idA, status: 'CANCELED' })
    expect(await saldoNoBanco(c.business.id, c.cliente.id)).toBe(200)
    const de_novo = await post(cancelar, `/v1/loyalty/redemptions/${idA}/cancel`, undefined, { token: c.tokenCliente, params: { id: idA } })
    expect(de_novo.status).toBe(409)
    expect(apiError(de_novo.json).reason).toBe('invalid_transition')
  })
})

describe('GET /v1/loyalty/ranking', () => {
  test('desligado: enabled false; ligado: primeiros nomes', async () => {
    await lancar(c.business.id, c.cliente.id, 40, { kind: 'EARN' })
    expect(jsonObject((await get(obterRanking, '/v1/loyalty/ranking')).json)).toMatchObject({ enabled: false, entries: [] })
    const dono = await makeCtx(c.business)
    const cfg = await getLoyaltySettings(dono)
    await updateLoyaltySettings(dono, cfg.version, { rankingEnabled: true })
    const r = await get(obterRanking, '/v1/loyalty/ranking', c.tokenCliente)
    expect(r.status).toBe(200)
    const corpo = jsonObject(r.json)
    expect(corpo.enabled).toBe(true)
    expect(corpo.entries).toEqual([{ position: 1, firstName: 'Cliente', avatarUrl: null, points: 40 }])
  })
})

describe('revisão: custo esperado, extrato e OpenAPI', () => {
  test('POST com expectedCostPoints diferente do custo atual: 409 changed, sem débito', async () => {
    await lancar(c.business.id, c.cliente.id, 1000)
    const dono = await makeCtx(c.business)
    await prisma.prize.update({ where: { id: premio.id }, data: { costPoints: 500 } })
    const r = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id, expectedCostPoints: 100 }, { token: c.tokenCliente })
    expect(r.status).toBe(409)
    expect(apiError(r.json).reason).toBe('changed')
    expect(await prisma.prizeRedemption.count()).toBe(0)
    const ok = await post(resgatar, '/v1/loyalty/redemptions', { prizeId: premio.id, expectedCostPoints: 500 }, { token: c.tokenCliente })
    expect(ok.status).toBe(201)
    void dono
  })

  test('extrato do cliente mostra "Ajuste" no lugar do motivo interno', async () => {
    const dono = await makeCtx(c.business)
    const { adjustPoints } = await import('@/server/domain/loyalty/ledger')
    await adjustPoints(dono, { customerId: c.cliente.id, points: 20, reason: 'Motivo interno da equipe' })
    const r = await get(obterExtrato, '/v1/loyalty/me/statement', c.tokenCliente)
    expect(r.status).toBe(200)
    expect(r.text).not.toContain('Motivo interno')
    expect((jsonObject(r.json).items as Record<string, unknown>[])[0]?.reason).toBe('Ajuste')
  })

  test('o cabeçalho Idempotency-Key da rota de resgate fala em resgate, não em agendamento', async () => {
    const { buildOpenApi } = await import('@/server/api/openapi')
    const doc = JSON.parse(JSON.stringify(buildOpenApi())) as { paths: Record<string, { post: { parameters: { name: string; description: string }[] } }> }
    const cabecalho = doc.paths['/v1/loyalty/redemptions']?.post.parameters.find((p) => p.name === 'Idempotency-Key')?.description ?? ''
    expect(cabecalho).toContain('o mesmo registro')
    expect(cabecalho).not.toContain('agendamento')
  })
})
