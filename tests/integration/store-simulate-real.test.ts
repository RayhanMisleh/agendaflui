import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { canSimulatePayment, simulateApprovedPayment, simulationAllowed } from '@/server/domain/store/simulate'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, produto } from '../setup/store'
import { pedidoComRetirada } from '../setup/store-orders'

// Com INTEGRATIONS_MODE=real (como em produção) o pagamento simulado NUNCA funciona, nem com um Mercado Pago falso injetado.
const antes = vi.hoisted(() => {
  const anterior = process.env.INTEGRATIONS_MODE
  process.env.INTEGRATIONS_MODE = 'real'
  return anterior
})
afterAll(() => {
  if (antes === undefined) delete process.env.INTEGRATIONS_MODE
  else process.env.INTEGRATIONS_MODE = antes
})

beforeEach(resetDb)

describe('pagamento simulado fora do modo falso', () => {
  test('modo real: simulationAllowed é falso, a tela não oferece e o domínio recusa sem gravar nada', async () => {
    const c = await cenaLoja()
    setIntegrationsForTests({ mercadoPago: fakeMercadoPago() })
    const p = await produto(c.dono, { stock: 5 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect(simulationAllowed()).toBe(false)
    expect(canSimulatePayment()).toBe(false)
    const e = await domainError(simulateApprovedPayment(c.dono, order.id))
    expect(e.code).toBe('forbidden')
    expect(e.message).toBe('O pagamento simulado só existe no ambiente de teste.')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_PAYMENT')
    expect(await prisma.payment.count()).toBe(0)
    setIntegrationsForTests(null)
  })
})
