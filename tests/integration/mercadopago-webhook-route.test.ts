import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as rota from '@/app/app/webhooks/mercadopago/[key]/route'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { estoque } from '../setup/store-orders'
import { assinar, cenaPagamento, pagamentoMp, type CenaPagamento } from '../setup/store-payments'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

let c: CenaPagamento
beforeEach(async () => {
  c = await cenaPagamento()
})

function chamar(o: { key?: string; dataId?: string | null; type?: string | null; assinatura?: string | null; body?: string; ip?: string } = {}) {
  const url = new URL(`http://app.localhost:3000/webhooks/mercadopago/${o.key ?? c.webhookKey}`)
  if (o.dataId !== null) url.searchParams.set('data.id', o.dataId ?? '3001')
  if (o.type !== null) url.searchParams.set('type', o.type ?? 'payment')
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': 'req-1', 'x-forwarded-for': o.ip ?? '203.0.113.9' })
  const dataId = o.dataId ?? '3001'
  const assinatura = o.assinatura === undefined ? assinar({ dataId, businessId: c.b.id }) : o.assinatura
  if (assinatura !== null) headers.set('x-signature', assinatura)
  return rota.POST(new Request(url, { method: 'POST', headers, body: o.body ?? JSON.stringify({ type: 'payment', data: { id: dataId } }) }), { params: Promise.resolve({ key: o.key ?? c.webhookKey }) })
}

const linha = () => prisma.order.findUniqueOrThrow({ where: { id: c.pedido.id } })

describe('POST /webhooks/mercadopago/{key}', () => {
  test('é uma rota simples: só POST, sem defineRoute e sem OPTIONS', () => {
    expect(Object.keys(rota).sort()).toEqual(['POST'])
    const fonte = readFileSync('src/app/app/webhooks/mercadopago/[key]/route.ts', 'utf8')
    expect(fonte).not.toContain('defineRoute')
  })

  test('assinatura certa e pagamento aprovado: 200 sem corpo, pedido pago', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001' }))
    const r = await chamar()
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect((await linha()).status).toBe('PAID')
  })

  test('o corpo é ignorado: corpo dizendo approved com a consulta dizendo rejected não paga; corpo inválido não atrapalha', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001', status: 'rejected', approvedAt: null }))
    const r = await chamar({ body: JSON.stringify({ type: 'payment', action: 'payment.updated', status: 'approved', data: { id: '3001', status: 'approved', transaction_amount: 50, external_reference: c.pedido.id } }) })
    expect(r.status).toBe(200)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect((await chamar({ body: '{{{não é json' })).status).toBe(200)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('assinatura ausente é aceita (a chave secreta da URL autentica e a situação vem da consulta)', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001' }))
    const r = await chamar({ assinatura: null })
    expect(r.status).toBe(200)
    expect(c.fake.calls.map((x) => x.method)).toEqual(['getPayment'])
    expect((await linha()).status).toBe('PAID')
  })

  test('assinatura errada: 401 sem corpo e sem consulta', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001' }))
    for (const a of ['', 'ts=1,v1=00', assinar({ dataId: '3001', secret: 'segredo-de-outra-conta-0123456789' })]) {
      const r = await chamar({ assinatura: a })
      expect(r.status).toBe(401)
      expect(await r.text()).toBe('')
    }
    expect(c.fake.calls).toHaveLength(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('chave desconhecida: 404; Mercado Pago fora do ar: 503; type merchant_order: 200 sem consulta', async () => {
    expect((await chamar({ key: 'chave-que-nao-existe-0123456789' })).status).toBe(404)
    c.fake.failWith('unavailable')
    expect((await chamar()).status).toBe(503)
    expect(await prisma.payment.count()).toBe(0)
    c.fake.failWith(null)
    const antes = c.fake.calls.length
    expect((await chamar({ type: 'merchant_order' })).status).toBe(200)
    expect(c.fake.calls.length).toBe(antes)
  })

  test('com a Loja desligada ainda processa', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001' }))
    expect((await chamar()).status).toBe(200)
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('erro inesperado: 500 sem corpo e sem detalhe no log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '3001' }))
    const espiao = vi.spyOn(prisma.businessIntegration, 'findUnique').mockRejectedValue(new Error('segredo-no-erro whsecabcdef0123456789Hy5N'))
    const r = await chamar()
    espiao.mockRestore()
    expect(r.status).toBe(500)
    expect(await r.text()).toBe('')
    expect(JSON.stringify(log.mock.calls)).not.toContain('whsecabcdef')
    log.mockRestore()
  })

  test('limite por IP e chave: outra chave do mesmo IP segue livre; o teto geral do IP vale para chaves inventadas', async () => {
    const b = await cenaPagamento()
    for (let i = 0; i < 120; i++) expect((await chamar({ ip: '198.51.100.20', type: 'merchant_order' })).status).toBe(200)
    expect((await chamar({ ip: '198.51.100.20', type: 'merchant_order' })).status).toBe(429)
    expect((await chamar({ ip: '198.51.100.20', key: b.webhookKey, type: 'merchant_order' })).status).toBe(200)
    for (let i = 0; i < 600; i++) expect((await chamar({ ip: '198.51.100.21', key: `chave-inventada-${String(i).padStart(4, '0')}-0123456789` })).status).toBe(404)
    expect((await chamar({ ip: '198.51.100.21', key: 'chave-inventada-9999-0123456789' })).status).toBe(429)
  })

  test('limite por IP: depois de 120 chamadas por minuto responde 429; outro IP segue livre', async () => {
    for (let i = 0; i < 120; i++) expect((await chamar({ key: 'chave-que-nao-existe-0123456789', ip: '198.51.100.7' })).status).toBe(404)
    const r = await chamar({ key: 'chave-que-nao-existe-0123456789', ip: '198.51.100.7' })
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).not.toBeNull()
    expect((await chamar({ key: 'chave-que-nao-existe-0123456789', ip: '198.51.100.8' })).status).toBe(404)
  })
})
