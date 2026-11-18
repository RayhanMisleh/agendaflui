import { beforeEach, describe, expect, test } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { cancelOrder } from '@/server/domain/store/orders'
import { applyPayment } from '@/server/domain/store/payments'
import { issueCodesForOrder, redeemVoucherCode } from '@/server/domain/vouchers/codes'
import { resetDb } from '../setup/db'
import { ctxWithRole } from '../setup/factories'
import { pagamentoMp, notificar } from '../setup/store-payments'
import { webhookKeyDe } from '../setup/store-payments'
import { cenaVouchers, codigosDe, estoqueDoVoucher, pagar, pedidoDeVoucher, type CenaVouchers } from '../setup/vouchers'

// Concorrência de verdade: o resultado é provado pelo que está GRAVADO (linhas de voucher_codes, status, estoque, auditoria).

beforeEach(resetDb)

let c: CenaVouchers
beforeEach(async () => {
  c = await cenaVouchers()
})

const sistema = () => createSystemContext(c.b.id, () => c.now)
const pedido = async (n = 2) => (await pedidoDeVoucher(c.ctxCliente, [{ voucherId: c.voucher.id, quantity: n }])).order

describe('geração de códigos sob repetição e concorrência', () => {
  test('a mesma notificação 3 vezes em paralelo gera 2 códigos para 2 unidades', async () => {
    const o = await pedido(2)
    c.fake.registerPayment(pagamentoMp(o, { id: '7001' }))
    const key = await webhookKeyDe(c.b.id)
    const r = await Promise.all([notificar({ webhookKey: key }, '7001'), notificar({ webhookKey: key }, '7001'), notificar({ webhookKey: key }, '7001')])
    expect(r.map((x) => x.status)).toEqual([200, 200, 200])
    expect(await codigosDe(o.id)).toHaveLength(2)
    expect(await prisma.payment.count()).toBe(1)
  })

  test('applyPayment 5 vezes em paralelo: 2 códigos', async () => {
    const o = await pedido(2)
    const ctx = await sistema()
    const pg = pagamentoMp(o)
    await Promise.all(Array.from({ length: 5 }, () => applyPayment(ctx, o.id, pg)))
    expect(await codigosDe(o.id)).toHaveLength(2)
  })

  test('dois pagamentos aprovados diferentes ao mesmo tempo: ainda 2 códigos', async () => {
    const o = await pedido(2)
    const ctx = await sistema()
    await Promise.all([applyPayment(ctx, o.id, pagamentoMp(o, { id: '8001' })), applyPayment(ctx, o.id, pagamentoMp(o, { id: '8002' }))])
    expect(await codigosDe(o.id)).toHaveLength(2)
  })

  test('issueCodesForOrder em 4 transações paralelas SEM a trava do pedido: o banco (seq único + skipDuplicates) deixa só os códigos devidos', async () => {
    const o = await pedido(3)
    await prisma.order.update({ where: { id: o.id }, data: { status: 'PAID', paidAt: c.now } })
    const ctx = await sistema()
    const r = await Promise.all(Array.from({ length: 4 }, () => ctx.db.$transaction((tx) => issueCodesForOrder(tx, ctx, o.id))))
    expect(r.reduce((a, b) => a + b, 0)).toBe(3)
    const codigos = await codigosDe(o.id)
    expect(codigos.map((x) => x.seq)).toEqual([1, 2, 3])
    expect(new Set(codigos.map((x) => x.code)).size).toBe(3)
  })
})

describe('baixa sob concorrência', () => {
  test('duas baixas simultâneas do mesmo código: uma passa, a outra é already_redeemed, uma auditoria', async () => {
    const o = await pedido(1)
    await pagar(c, o)
    const code = (await codigosDe(o.id))[0]?.code ?? ''
    const r = await Promise.allSettled([redeemVoucherCode(c.dono, code), redeemVoucherCode(c.gerente, code)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const falha = r.find((x) => x.status === 'rejected')
    expect(falha).toMatchObject({ reason: { code: 'conflict', reason: 'already_redeemed' } })
    expect(await prisma.auditLog.count({ where: { action: 'voucher_code.redeemed' } })).toBe(1)
    const gravado = (await codigosDe(o.id))[0]
    expect(gravado?.status).toBe('REDEEMED')
    expect(gravado?.redeemedById).not.toBeNull()
  })

  test('6 baixas simultâneas do mesmo código por 3 pessoas: exatamente uma passa', async () => {
    const o = await pedido(1)
    await pagar(c, o)
    const code = (await codigosDe(o.id))[0]?.code ?? ''
    const terceiro = await ctxWithRole(c.b, 'MANAGER', { now: c.now })
    const r = await Promise.allSettled([c.dono, c.gerente, terceiro, c.dono, c.gerente, terceiro].map((ctx) => redeemVoucherCode(ctx, code)))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { action: 'voucher_code.redeemed' } })).toBe(1)
  })

  test('códigos diferentes do mesmo pedido, baixados juntos, passam todos', async () => {
    const o = await pedido(3)
    await pagar(c, o)
    const codigos = await codigosDe(o.id)
    const r = await Promise.allSettled(codigos.map((x) => redeemVoucherCode(c.dono, x.code)))
    expect(r.every((x) => x.status === 'fulfilled')).toBe(true)
    expect((await codigosDe(o.id)).map((x) => x.status)).toEqual(['REDEEMED', 'REDEEMED', 'REDEEMED'])
  })

  test('estorno e baixa ao mesmo tempo terminam coerentes: usado e sinalizado, ou anulado e recusado', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const o = await pedido(1)
      const pg = pagamentoMp(o)
      const ctx = await sistema()
      await applyPayment(ctx, o.id, pg)
      const code = (await codigosDe(o.id))[0]?.code ?? ''
      const [baixa] = await Promise.allSettled([redeemVoucherCode(c.dono, code), applyPayment(ctx, o.id, { ...pg, status: 'refunded' })])
      const x = (await codigosDe(o.id))[0]
      const ordem = await prisma.order.findUniqueOrThrow({ where: { id: o.id } })
      expect(ordem.status).toBe('CANCELED')
      if (baixa.status === 'fulfilled') {
        expect(x?.status).toBe('REDEEMED')
        expect(ordem.attention).toBe('payment_reversed')
      } else {
        expect(baixa.reason).toMatchObject({ reason: 'code_void' })
        expect(x?.status).toBe('VOID')
        expect(ordem.attention).toBeNull()
      }
    }
  })

  test('cancelamento pela equipe e baixa ao mesmo tempo: nunca um pedido cancelado com código usado', async () => {
    for (let rodada = 0; rodada < 4; rodada++) {
      const o = await pedido(1)
      await pagar(c, o)
      const code = (await codigosDe(o.id))[0]?.code ?? ''
      const [baixa, cancelamento] = await Promise.allSettled([redeemVoucherCode(c.dono, code), cancelOrder(c.gerente, o.id)])
      const x = (await codigosDe(o.id))[0]
      const ordem = await prisma.order.findUniqueOrThrow({ where: { id: o.id } })
      if (baixa.status === 'fulfilled') {
        expect(cancelamento).toMatchObject({ status: 'rejected', reason: { reason: 'codes_in_use' } })
        expect(x?.status).toBe('REDEEMED')
        expect(ordem.status).toBe('PAID')
      } else {
        expect(cancelamento.status).toBe('fulfilled')
        expect(x?.status).toBe('VOID')
        expect(ordem.status).toBe('CANCELED')
      }
    }
  })
})

describe('estoque do voucher sob concorrência', () => {
  test('estoque 2 e 4 pedidos de 1 ao mesmo tempo: dois passam, dois são out_of_stock, estoque 0', async () => {
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { stock: 2 } })
    const r = await Promise.allSettled([c.ctxCliente, c.ctxOutro, c.ctxCliente, c.ctxOutro].map((ctx) => pedidoDeVoucher(ctx, [{ voucherId: c.voucher.id, quantity: 1 }])))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(2)
    expect(r.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason?.reason === 'out_of_stock')).toBe(true)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(0)
    expect(await prisma.order.count()).toBe(2)
  })
})
