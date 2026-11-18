import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { sweepStore } from '@/server/domain/platform/store-sweep'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { cenaLoja, configurarIntegracoes, produto } from '../setup/store'
import { estoque, pedidoComRetirada } from '../setup/store-orders'
import { cenaPagamento, pagamentoMp, type CenaPagamento } from '../setup/store-payments'

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

const MIN = 60_000
const HORA = 60 * MIN
let c: CenaPagamento
const depois = (ms: number) => new Date(c.now.getTime() + ms)
const linha = (id = c.pedido.id) => prisma.order.findUniqueOrThrow({ where: { id } })
/** Marca que o cliente abriu o checkout (o pedido tem preferência). */
const comPreferencia = (id = c.pedido.id) => prisma.order.update({ where: { id }, data: { mpPreferenceId: 'pref-x', checkoutUrl: 'https://mp.test/x' } })

beforeEach(async () => {
  c = await cenaPagamento()
})

describe('sweepStore', () => {
  test('pedido vencido cujo pagamento foi aprovado e o aviso se perdeu vira pago; o outro, sem pagamento, vence', async () => {
    await comPreferencia()
    c.fake.registerPayment(pagamentoMp(c.pedido))
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])
    await comPreferencia(outro.order.id)
    const r = await sweepStore(depois(61 * MIN))
    expect(r).toEqual({ synced: 2, expired: 1 })
    expect((await linha()).status).toBe('PAID')
    expect((await linha(outro.order.id)).status).toBe('EXPIRED')
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('pedido sem preferência (nunca abriu o pagamento) vence sem falar com o Mercado Pago', async () => {
    const r = await sweepStore(depois(61 * MIN))
    expect(r).toEqual({ synced: 0, expired: 1 })
    expect(c.fake.calls).toHaveLength(0)
    expect(await estoque(c.produto.id)).toBe(10)
  })

  test('não toca no que ainda está no prazo', async () => {
    await comPreferencia()
    expect(await sweepStore(depois(59 * MIN))).toEqual({ synced: 0, expired: 0 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect(c.fake.calls).toHaveLength(0)
  })

  test('Mercado Pago fora do ar adia o vencimento; passadas 24 h do prazo, vence mesmo assim', async () => {
    await comPreferencia()
    c.fake.failWith('unavailable')
    expect(await sweepStore(depois(61 * MIN))).toEqual({ synced: 0, expired: 0 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect(await estoque(c.produto.id)).toBe(8)
    expect(await sweepStore(depois(60 * MIN + 23 * HORA))).toEqual({ synced: 0, expired: 0 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect(await sweepStore(depois(60 * MIN + 24 * HORA + 1))).toEqual({ synced: 0, expired: 1 })
    expect((await linha()).status).toBe('EXPIRED')
    expect(await estoque(c.produto.id)).toBe(10)
  })

  test('voltando o Mercado Pago, a rodada seguinte confere e resolve', async () => {
    await comPreferencia()
    c.fake.registerPayment(pagamentoMp(c.pedido))
    c.fake.failWith('unavailable')
    await sweepStore(depois(61 * MIN))
    c.fake.failWith(null)
    expect(await sweepStore(depois(62 * MIN))).toEqual({ synced: 1, expired: 0 })
    expect((await linha()).status).toBe('PAID')
  })

  test('conta com preferência mas sem credenciais legíveis: adia, não vence', async () => {
    await comPreferencia()
    await prisma.businessIntegration.update({ where: { businessId: c.b.id }, data: { mpAccessTokenEnc: null, mpAccessTokenLast4: null } })
    expect(await sweepStore(depois(61 * MIN))).toEqual({ synced: 0, expired: 0 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('repetir a varredura não faz nada de novo', async () => {
    await comPreferencia()
    c.fake.registerPayment(pagamentoMp(c.pedido))
    await sweepStore(depois(61 * MIN))
    expect(await sweepStore(depois(61 * MIN))).toEqual({ synced: 0, expired: 0 })
    expect(await prisma.payment.count()).toBe(1)
  })

  test('funciona com a Loja desligada e a conta suspensa', async () => {
    await comPreferencia()
    c.fake.registerPayment(pagamentoMp(c.pedido))
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    await prisma.business.update({ where: { id: c.b.id }, data: { status: 'SUSPENDED' } })
    expect(await sweepStore(depois(61 * MIN))).toEqual({ synced: 1, expired: 0 })
    expect((await linha()).status).toBe('PAID')
  })

  test('duas contas na mesma rodada, cada uma com o token dela; a falha de uma não para a outra', async () => {
    const b = await cenaLoja()
    await configurarIntegracoes(b.b.id, { mercadoPago: true })
    const pb = await produto(b.dono, { stock: 5 })
    const pedidoB = await pedidoComRetirada(b.ctxCliente, [{ productId: pb.id, quantity: 1 }])
    await comPreferencia()
    await comPreferencia(pedidoB.order.id)
    c.fake.registerPayment(pagamentoMp(pedidoB.order))
    // a consulta da conta A falha, a de B segue
    const ruim = fakeMercadoPago()
    ruim.failWith('unavailable')
    const real = c.fake
    setIntegrationsForTests({
      mercadoPago: {
        createPreference: (t, p) => real.createPreference(t, p),
        getPayment: (t, id) => real.getPayment(t, id),
        searchPaymentsByReference: (t, ref) => (ref === c.pedido.id ? ruim.searchPaymentsByReference(t, ref) : real.searchPaymentsByReference(t, ref)),
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await sweepStore(depois(61 * MIN))
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect((await linha(pedidoB.order.id)).status).toBe('PAID')
    expect(r.synced).toBe(1)
  })
})
