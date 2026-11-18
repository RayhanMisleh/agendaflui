import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { cenaLoja, produto, type CenaLoja } from '../setup/store'
import { estoque, pedidoComRetirada } from '../setup/store-orders'

const falha = vi.hoisted(() => ({ id: null as string | null }))
vi.mock('@/server/domain/store/order-events', async (original) => {
  const real = await original<typeof import('@/server/domain/store/order-events')>()
  return {
    ...real,
    orderVoided: async (...a: Parameters<typeof real.orderVoided>) => {
      if (a[2] === falha.id) throw new Error('falha de teste com dado@pessoal.test')
      return real.orderVoided(...a)
    },
  }
})
import { expireOverdueOrders } from '@/server/domain/store/expiry'

beforeEach(resetDb)
let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
  falha.id = null
})

describe('varredura de vencimento', () => {
  test('erro num pedido não interrompe os seguintes: registra só o nome do erro e segue', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const p = await produto(c.dono, { stock: 10 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const b = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])
    const d = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    falha.id = a.order.id
    const sistema = await createSystemContext(c.b.id, () => new Date(c.now.getTime() + 61 * 60_000))
    expect(await expireOverdueOrders(sistema)).toBe(2)
    const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status
    expect(await status(a.order.id)).toBe('AWAITING_PAYMENT')
    expect(await status(b.order.id)).toBe('EXPIRED')
    expect(await status(d.order.id)).toBe('EXPIRED')
    expect(await estoque(p.id)).toBe(9)
    const texto = JSON.stringify(log.mock.calls)
    expect(texto).toContain('Error')
    expect(texto).not.toContain('dado@pessoal')
    // a rodada seguinte tenta de novo o que falhou
    falha.id = null
    expect(await expireOverdueOrders(sistema)).toBe(1)
    expect(await estoque(p.id)).toBe(10)
    log.mockRestore()
  })
})
