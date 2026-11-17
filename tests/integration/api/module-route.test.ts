import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineRoute } from '@/server/api/define-route'
import { buildOpenApi, operation } from '@/server/api/openapi'
import { prisma } from '@/server/db/client'
import { z } from '@/server/domain/errors'
import { apiError, apiRequest, callRoute, jsonObject, makeAppKey } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { makeBusiness } from '../../setup/factories'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let chamadas = 0

const rota = defineRoute({
  method: 'POST',
  path: '/v1/teste/banners',
  auth: 'key',
  module: 'banners',
  summary: 'Rota de um módulo',
  tag: 'teste',
  body: z.object({ titulo: z.string().min(1) }),
  response: z.object({ ok: z.literal(true) }),
  handler: async () => {
    chamadas += 1
    return { ok: true as const }
  },
})

beforeEach(async () => {
  chamadas = 0
  await resetDb()
})

async function chamar(slugKey: string, corpo: unknown) {
  return callRoute(rota, apiRequest('POST', '/v1/teste/banners', { key: slugKey, body: corpo }))
}

describe('rota com `module`', () => {
  test('módulo desligado com corpo inválido devolve 404 module_disabled, nunca 422, sem chamar o handler', async () => {
    const conta = await makeBusiness()
    const { secret } = await makeAppKey(conta.id)
    const r = await chamar(secret, {})
    expect(r.status).toBe(404)
    const erro = apiError(r.json)
    expect(erro.code).toBe('module_disabled')
    expect(erro.message).toBe('O módulo Banners não está ligado nesta conta.')
    expect(chamadas).toBe(0)
  })

  test('módulo ligado com corpo inválido devolve 422', async () => {
    const conta = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: conta.id }, data: { banners: true } })
    const { secret } = await makeAppKey(conta.id)
    const r = await chamar(secret, {})
    expect(r.status).toBe(422)
    expect(chamadas).toBe(0)
  })

  test('módulo ligado com corpo válido roda o handler', async () => {
    const conta = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: conta.id }, data: { banners: true } })
    const { secret } = await makeAppKey(conta.id)
    const r = await chamar(secret, { titulo: 'Oi' })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json).ok).toBe(true)
    expect(chamadas).toBe(1)
  })

  test('outro módulo ligado não libera a rota', async () => {
    const conta = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: conta.id }, data: { store: true } })
    const { secret } = await makeAppKey(conta.id)
    expect((await chamar(secret, { titulo: 'Oi' })).status).toBe(404)
    expect(chamadas).toBe(0)
  })

  test('o documento OpenAPI da rota cita o módulo e a resposta 404 cita module_disabled', () => {
    const op = operation(rota.definition)
    expect(op.description).toContain('Exige o módulo Banners ligado')
    expect(op.responses).toHaveProperty('404')
    const doc = JSON.stringify(buildOpenApi())
    expect(doc).toContain('o módulo da rota está desligado: `error.code` é `module_disabled`')
  })
})
