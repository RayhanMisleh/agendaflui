import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as umVoucher } from '@/app/api/v1/vouchers/[id]/route'
import { GET as listarVouchers } from '@/app/api/v1/vouchers/route'
import { GET as meusCodigos } from '@/app/api/v1/me/voucher-codes/route'
import { POST as criarPedido } from '@/app/api/v1/store/orders/route'
import { prisma } from '@/server/db/client'
import { redeemVoucherCode } from '@/server/domain/vouchers/codes'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'
import { createPartnerDireto, createVoucherDireto, codigosDe, pagar } from '../../setup/vouchers'
import { createOrder } from '@/server/domain/store/orders'
import { ctxDoCliente } from '../../setup/loyalty'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena
let dono: Awaited<ReturnType<typeof makeCtx>>
let voucherId: string

beforeEach(async () => {
  await resetDb()
  setIntegrationsForTests({ mercadoPago: fakeMercadoPago() })
  c = await montarCena()
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: true, vouchers: true } })
  dono = await makeCtx(c.business)
  const parceiro = await createPartnerDireto(c.business.id)
  voucherId = (await createVoucherDireto(c.business.id, parceiro.id)).id
})

const get = (h: Parameters<typeof callRoute>[0], path: string, o: { token?: string; params?: Record<string, string>; key?: boolean } = {}) =>
  callRoute(h, apiRequest('GET', path, { ...(o.key === false ? {} : { key: c.key }), ...(o.token ? { token: o.token } : {}) }), o.params ?? {})
let chaves = 0
const post = (path: string, body: unknown, token: string) => callRoute(criarPedido, apiRequest('POST', path, { key: c.key, token, body, headers: { 'idempotency-key': `v-${++chaves}` } }))

/** Compra e paga `n` unidades do voucher pelo domínio (o pagamento é o mesmo do webhook). */
async function comprar(customer: { id: string }, n = 1) {
  const ctx = await ctxDoCliente(c.business, customer as never)
  const { order } = await createOrder(ctx, { lines: [{ voucherId, quantity: n }], delivery: { method: 'NONE' }, note: null })
  await pagar({ b: c.business, now: new Date() }, order)
  return order
}

describe('módulo desligado', () => {
  test('todas as rotas respondem 404 module_disabled, antes de validar parâmetros', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { vouchers: false } })
    const respostas = [
      await get(listarVouchers, '/v1/vouchers?lixo=1'),
      await get(umVoucher, '/v1/vouchers/x', { params: { id: 'nao-uuid' } }),
      await get(meusCodigos, '/v1/me/voucher-codes', { token: c.tokenCliente }),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(404)
      expect(apiError(r.json).code).toBe('module_disabled')
    }
  })

  test('pedido com linha de voucher e o módulo desligado: 404 module_disabled e nada é criado', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { vouchers: false } })
    const r = await post('/v1/store/orders', { lines: [{ voucherId, quantity: 1 }], delivery: { method: 'NONE' } }, c.tokenCliente)
    expect(r.status).toBe(404)
    expect(apiError(r.json).code).toBe('module_disabled')
    expect(await prisma.order.count()).toBe(0)
  })
})

describe('GET /v1/vouchers e /v1/vouchers/{id}', () => {
  test('lista o que está à venda, com o parceiro e sem estoque nem dado interno', async () => {
    const r = await get(listarVouchers, '/v1/vouchers')
    expect(r.status).toBe(200)
    const itens = jsonObject(r.json).items as Record<string, unknown>[]
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ id: voucherId, name: 'Jantar para dois', priceCents: 12000, validDays: 30, available: true, maxQuantity: 10, partner: { name: 'Restaurante Sabor do Rio' } })
    expect(Object.keys(itens[0] ?? {}).sort()).toEqual(['available', 'description', 'id', 'imageUrl', 'maxQuantity', 'name', 'partner', 'priceCents', 'terms', 'validDays'])
    expect(Object.keys((itens[0]?.partner ?? {}) as object).sort()).toEqual(['address', 'logoUrl', 'name', 'phone', 'website'])
    expect(r.text).not.toContain('"stock"')
  })

  test('vouchers inativos, arquivados e de outra conta não aparecem; o id deles é 404', async () => {
    const parceiro = await createPartnerDireto(c.business.id)
    const inativo = await createVoucherDireto(c.business.id, parceiro.id, { active: false })
    const outra = await montarCena()
    await prisma.businessModules.update({ where: { businessId: outra.business.id }, data: { store: true, vouchers: true } })
    const pOutra = await createPartnerDireto(outra.business.id)
    const vOutra = await createVoucherDireto(outra.business.id, pOutra.id)
    const itens = jsonObject((await get(listarVouchers, '/v1/vouchers')).json).items as { id: string }[]
    expect(itens.map((i) => i.id)).toEqual([voucherId])
    for (const id of [inativo.id, vOutra.id]) {
      const r = await get(umVoucher, `/v1/vouchers/${id}`, { params: { id } })
      expect(r.status).toBe(404)
    }
    expect((await get(umVoucher, `/v1/vouchers/${voucherId}`, { params: { id: voucherId } })).status).toBe(200)
  })

  test('exige a chave do app', async () => {
    expect((await get(listarVouchers, '/v1/vouchers', { key: false })).status).toBe(401)
  })
})

describe('GET /v1/me/voucher-codes', () => {
  test('o cliente vê só os próprios códigos, com situação, validade e parceiro, sem dado interno', async () => {
    await comprar(c.cliente, 2)
    await comprar(c.outro, 1)
    const r = await get(meusCodigos, '/v1/me/voucher-codes', { token: c.tokenCliente })
    expect(r.status).toBe(200)
    const itens = jsonObject(r.json).items as Record<string, unknown>[]
    expect(itens).toHaveLength(2)
    expect(itens[0]).toMatchObject({ status: 'ACTIVE', voucher: { id: voucherId, name: 'Jantar para dois' }, partner: { name: 'Restaurante Sabor do Rio' } })
    expect(itens[0]?.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
    expect(typeof itens[0]?.expiresAt).toBe('string')
    expect(Object.keys(itens[0] ?? {})).not.toContain('customer')
    expect(Object.keys(itens[0] ?? {})).not.toContain('voidReason')
    const meus = (await prisma.voucherCode.findMany({ where: { customerId: c.cliente.id } })).map((x) => x.code).sort()
    expect(itens.map((i) => i.code).sort()).toEqual(meus)
    expect(r.text).not.toContain(c.cliente.id)
    const outro = jsonObject((await get(meusCodigos, '/v1/me/voucher-codes', { token: c.tokenOutro })).json).items as { code: string }[]
    expect(outro).toHaveLength(1)
    expect(meus).not.toContain(outro[0]?.code)
  })

  test('mostra o código usado como REDEEMED', async () => {
    const o = await comprar(c.cliente, 1)
    await redeemVoucherCode(dono, (await codigosDe(o.id))[0]?.code ?? '')
    const itens = jsonObject((await get(meusCodigos, '/v1/me/voucher-codes', { token: c.tokenCliente })).json).items as { status: string }[]
    expect(itens.map((i) => i.status)).toEqual(['REDEEMED'])
  })

  test('exige login de cliente (sem token, 401)', async () => {
    expect((await get(meusCodigos, '/v1/me/voucher-codes')).status).toBe(401)
  })
})

describe('POST /v1/store/orders com voucher', () => {
  test('só voucher com NONE: 201, item do tipo voucher e estoque reservado', async () => {
    const r = await post('/v1/store/orders', { lines: [{ voucherId, quantity: 2 }], delivery: { method: 'NONE' } }, c.tokenCliente)
    expect(r.status).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({ deliveryMethod: 'NONE', totalCents: 24000, items: [{ kind: 'voucher', id: voucherId, quantity: 2, unitPriceCents: 12000 }] })
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: voucherId } })).stock).toBe(8)
  })

  test('só voucher com retirada: 422; preço no corpo: 422', async () => {
    expect((await post('/v1/store/orders', { lines: [{ voucherId, quantity: 1 }], delivery: { method: 'PICKUP' } }, c.tokenCliente)).status).toBe(422)
    expect((await post('/v1/store/orders', { lines: [{ voucherId, quantity: 1, priceCents: 1 }], delivery: { method: 'NONE' } }, c.tokenCliente)).status).toBe(422)
    expect(await prisma.order.count()).toBe(0)
  })
})
