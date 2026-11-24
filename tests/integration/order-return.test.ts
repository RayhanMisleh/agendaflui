import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { refreshMyOrderPayment } from '@/server/domain/store/checkout'
import { setIntegrationsForTests } from '@/server/integrations'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxDoCliente } from '../setup/store'
import { pagamentoMp, cenaPagamento, type CenaPagamento } from '../setup/store-payments'
import { marcarPago } from '../setup/store-orders'
import { makeCtx } from '../setup/factories'

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

let c: CenaPagamento
beforeEach(async () => {
  c = await cenaPagamento()
})

const situacao = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status

describe('refreshMyOrderPayment', () => {
  test('volta do pagamento aprovado: pedido fica pago', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido))
    const v = await refreshMyOrderPayment(c.ctxCliente, c.pedido.id)
    expect(v.status).toBe('PAID')
    expect(await situacao(c.pedido.id)).toBe('PAID')
  })

  test('segunda volta em menos de 30 s não consulta de novo; depois de 30 s, consulta', async () => {
    await refreshMyOrderPayment(c.ctxCliente, c.pedido.id)
    expect(c.fake.calls.map((x) => x.method)).toEqual(['searchPaymentsByReference'])
    const v = await refreshMyOrderPayment(c.ctxCliente, c.pedido.id)
    expect(v.status).toBe('AWAITING_PAYMENT')
    expect(c.fake.calls).toHaveLength(1)
    // O pagamento chega; passados 30 s a tela consulta de novo e vê o pagamento.
    c.fake.registerPayment(pagamentoMp(c.pedido))
    const depois = await ctxDoCliente(c.b, c.cliente, addMinutes(c.now, 1))
    expect((await refreshMyOrderPayment(depois, c.pedido.id)).status).toBe('PAID')
    expect(c.fake.calls).toHaveLength(2)
  })

  test('pedido de outro cliente → not_found e nada é consultado', async () => {
    const e = await domainError(refreshMyOrderPayment(c.ctxOutro, c.pedido.id))
    expect(e.code).toBe('not_found')
    expect(c.fake.calls).toHaveLength(0)
    expect((await domainError(refreshMyOrderPayment(c.ctxOutro, 'nao-e-id'))).code).toBe('not_found')
  })

  test('pedido já pago: devolve sem consultar', async () => {
    await marcarPago(c.pedido.id)
    const v = await refreshMyOrderPayment(c.ctxCliente, c.pedido.id)
    expect(v.status).toBe('PAID')
    expect(c.fake.calls).toHaveLength(0)
  })

  test('Mercado Pago fora do ar: devolve o pedido como está, sem erro', async () => {
    c.fake.failWith('unavailable')
    expect((await refreshMyOrderPayment(c.ctxCliente, c.pedido.id)).status).toBe('AWAITING_PAYMENT')
  })

  test('quem não é cliente (equipe ou visitante) não usa', async () => {
    expect((await domainError(refreshMyOrderPayment(c.dono, c.pedido.id))).code).toBe('forbidden')
    const guest = await makeCtx(c.b, { actor: { kind: 'guest' } })
    expect((await domainError(refreshMyOrderPayment(guest, c.pedido.id))).code).toBe('forbidden')
  })
})
