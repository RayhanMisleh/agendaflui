import { beforeEach, describe, expect, test } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { priceCart } from '@/server/domain/store/cart'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { cancelOrder, createOrder, getOrder } from '@/server/domain/store/orders'
import { applyPayment } from '@/server/domain/store/payments'
import { quoteShipping } from '@/server/domain/store/shipping'
import { findVoucherCode, issueCodesForOrder, listMyVoucherCodes, listVoucherCodes, listCodesOfOrder, redeemVoucherCode } from '@/server/domain/vouchers/codes'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { produto } from '../setup/store'
import { ENDERECO, enderecoDe, prepararEntrega, estoque } from '../setup/store-orders'
import { pagamentoMp } from '../setup/store-payments'
import { cenaVouchers, codigosDe, createPartnerDireto, createVoucherDireto, estoqueDoVoucher, pagar, pedidoDeVoucher, type CenaVouchers } from '../setup/vouchers'

beforeEach(resetDb)

let c: CenaVouchers
beforeEach(async () => {
  c = await cenaVouchers()
})

const linhaVoucher = (n = 1) => [{ voucherId: c.voucher.id, quantity: n }]
const ordem = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } })
const sistema = (now = c.now) => createSystemContext(c.b.id, () => now)

describe('carrinho e pedido de voucher', () => {
  test('com o módulo Vouchers desligado: module_disabled no preço e no pedido, e nada é reservado', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: false } })
    await expect(priceCart(c.ctxCliente, linhaVoucher())).rejects.toMatchObject({ code: 'module_disabled' })
    await expect(pedidoDeVoucher(c.ctxCliente, linhaVoucher())).rejects.toMatchObject({ code: 'module_disabled' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    expect(await prisma.order.count()).toBe(0)
  })

  test('Loja desligada (e com ela os Vouchers, que o banco não deixa ligados sem a Loja): module_disabled', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false, vouchers: false } })
    await expect(prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: true } })).rejects.toThrow()
    await expect(pedidoDeVoucher(c.ctxCliente, linhaVoucher())).rejects.toMatchObject({ code: 'module_disabled' })
    expect(await prisma.order.count()).toBe(0)
  })

  test('só vouchers com NONE gera o pedido: nome e preço copiados, estoque reservado, sem frete', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', deliveryMethod: 'NONE', itemsCents: 24000, shippingCents: 0, totalCents: 24000 })
    expect(order.items).toEqual([{ kind: 'voucher', id: c.voucher.id, name: 'Jantar para dois', unitPriceCents: 12000, quantity: 2, totalCents: 24000 }])
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })
    expect(item).toMatchObject({ voucherId: c.voucher.id, productId: null })
    // Mudar o preço e o nome depois não mexe no pedido.
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { priceCents: 1, name: 'Outro nome' } })
    expect((await getOrder(c.ctxCliente, order.id)).items[0]).toMatchObject({ name: 'Jantar para dois', unitPriceCents: 12000 })
  })

  test('só vouchers com PICKUP ou SHIPPING é recusado (validação) e nada é reservado', async () => {
    await expect(createOrder(c.ctxCliente, { lines: linhaVoucher(), delivery: { method: 'PICKUP' }, note: null })).rejects.toMatchObject({ code: 'validation', fields: { delivery: expect.any(String) } })
    await expect(createOrder(c.ctxCliente, { lines: linhaVoucher(), delivery: { method: 'SHIPPING', addressId: '00000000-0000-4000-8000-000000000000', quoteToken: 'x' }, note: null })).rejects.toMatchObject({ code: 'validation' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    expect(await prisma.order.count()).toBe(0)
  })

  test('preço enviado pelo app é recusado; o servidor usa o do banco', async () => {
    const linha = { voucherId: c.voucher.id, quantity: 1, priceCents: 1 } as unknown as { voucherId: string; quantity: number }
    await expect(pedidoDeVoucher(c.ctxCliente, [linha])).rejects.toMatchObject({ code: 'validation' })
    expect(await prisma.order.count()).toBe(0)
  })

  test('linha com produto e voucher juntos, sem nenhum dos dois ou repetida é recusada', async () => {
    const p = await produto(c.dono, { stock: 5 })
    const ambos = [{ productId: p.id, voucherId: c.voucher.id, quantity: 1 }] as unknown as { voucherId: string; quantity: number }[]
    await expect(pedidoDeVoucher(c.ctxCliente, ambos)).rejects.toMatchObject({ code: 'validation' })
    await expect(pedidoDeVoucher(c.ctxCliente, [{ quantity: 1 }] as unknown as { voucherId: string; quantity: number }[])).rejects.toMatchObject({ code: 'validation' })
    await expect(pedidoDeVoucher(c.ctxCliente, [...linhaVoucher(), ...linhaVoucher()])).rejects.toMatchObject({ code: 'validation' })
    await expect(pedidoDeVoucher(c.ctxCliente, linhaVoucher(100))).rejects.toMatchObject({ code: 'validation' })
  })

  test('voucher inativo, arquivado, de parceiro parado ou de outra conta não vende', async () => {
    const outra = await cenaVouchers()
    const parado = await createPartnerDireto(c.b.id, { active: false })
    const doParado = await createVoucherDireto(c.b.id, parado.id)
    const inativo = await createVoucherDireto(c.b.id, c.parceiro.id, { active: false })
    const arquivado = await prisma.voucher.update({ where: { id: (await createVoucherDireto(c.b.id, c.parceiro.id)).id }, data: { archivedAt: c.now } })
    for (const id of [outra.voucher.id, doParado.id, inativo.id, arquivado.id]) {
      await expect(pedidoDeVoucher(c.ctxCliente, [{ voucherId: id, quantity: 1 }])).rejects.toMatchObject({ code: 'validation', fields: { 'lines.0.voucherId': expect.any(String) } })
    }
    expect(await prisma.order.count()).toBe(0)
  })

  test('estoque: pedir mais que o que há é out_of_stock sem reservar nada; pedir tudo funciona', async () => {
    await expect(pedidoDeVoucher(c.ctxCliente, linhaVoucher(11))).rejects.toMatchObject({ code: 'conflict', reason: 'out_of_stock' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    await pedidoDeVoucher(c.ctxCliente, linhaVoucher(10))
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(0)
    await expect(pedidoDeVoucher(c.ctxOutro, linhaVoucher(1))).rejects.toMatchObject({ reason: 'out_of_stock' })
  })

  test('carrinho misto: retirada vale, NONE não; a reserva vale para os dois e a repetição da chave não reserva de novo', async () => {
    const p = await produto(c.dono, { stock: 5, priceCents: 2500 })
    const lines = [{ productId: p.id, quantity: 1 }, ...linhaVoucher(2)]
    await expect(createOrder(c.ctxCliente, { lines, delivery: { method: 'NONE' }, note: null })).rejects.toMatchObject({ code: 'validation' })
    const a = await createOrder(c.ctxCliente, { lines, delivery: { method: 'PICKUP' }, note: null, idempotencyKey: 'k1' })
    expect(a.order).toMatchObject({ deliveryMethod: 'PICKUP', itemsCents: 2500 + 24000, totalCents: 26500 })
    expect(a.order.items.map((i) => i.kind).sort()).toEqual(['product', 'voucher'])
    expect(await estoque(p.id)).toBe(4)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
    const b = await createOrder(c.ctxCliente, { lines, delivery: { method: 'PICKUP' }, note: null, idempotencyKey: 'k1' })
    expect(b).toMatchObject({ replayed: true, order: { id: a.order.id } })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
  })

  test('frete: voucher não entra no peso; carrinho só de vouchers não cota entrega', async () => {
    await prepararEntrega(c)
    const chamadas: { items: { sku: string; quantity: number }[]; invoiceValueCents: number }[] = []
    setIntegrationsForTests({
      mercadoPago: fakeMercadoPago(),
      frenet: {
        async quote(_t, input) {
          chamadas.push({ items: input.items, invoiceValueCents: input.invoiceValueCents })
          return [{ serviceCode: 'PAC', name: 'PAC', carrier: 'Correios', priceCents: 2150, days: 7 }]
        },
      },
    })
    const addr = await enderecoDe(c.ctxCliente, ENDERECO)
    const p = await produto(c.dono, { stock: 5, priceCents: 2500 })
    const misto = await quoteShipping(c.ctxCliente, { addressId: addr, lines: [{ productId: p.id, quantity: 1 }, ...linhaVoucher(2)] })
    expect(misto.options).toHaveLength(1)
    expect(chamadas[0]?.items).toHaveLength(1)
    expect(chamadas[0]?.items[0]?.sku).toBe(p.id)
    expect(chamadas[0]?.invoiceValueCents).toBe(2500)
    const so = await quoteShipping(c.ctxCliente, { addressId: addr, lines: linhaVoucher() })
    expect(so.options).toEqual([])
    expect(so.shippingError).toEqual(expect.any(String))
    expect(chamadas).toHaveLength(1)
  })

  test('pedido misto com entrega usa a cotação do mesmo carrinho (o hash cobre o voucher)', async () => {
    await prepararEntrega(c)
    const addr = await enderecoDe(c.ctxCliente, ENDERECO)
    const p = await produto(c.dono, { stock: 5 })
    const lines = [{ productId: p.id, quantity: 1 }, ...linhaVoucher(1)]
    const q = await quoteShipping(c.ctxCliente, { addressId: addr, lines })
    const token = q.options[0]?.quoteToken ?? ''
    await expect(createOrder(c.ctxCliente, { lines: [{ productId: p.id, quantity: 1 }], delivery: { method: 'SHIPPING', addressId: addr, quoteToken: token }, note: null })).rejects.toMatchObject({ reason: 'invalid_quote' })
    const { order } = await createOrder(c.ctxCliente, { lines, delivery: { method: 'SHIPPING', addressId: addr, quoteToken: token }, note: null })
    expect(order.shippingCents).toBe(q.options[0]?.priceCents)
  })
})

describe('estoque do voucher ao cancelar e vencer', () => {
  test('o cliente cancelando devolve o estoque do voucher uma vez; vencer também', async () => {
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(3))).order
    await cancelOrder(c.ctxCliente, a.id)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    await expect(cancelOrder(c.ctxCliente, a.id)).rejects.toMatchObject({ reason: 'invalid_transition' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    const b = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(4))).order
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(6)
    const depois = new Date(c.now.getTime() + 3 * 3600_000)
    expect(await expireOverdueOrders(await sistema(depois))).toBe(1)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    expect((await ordem(b.id)).status).toBe('EXPIRED')
  })
})

describe('códigos gerados no pagamento', () => {
  test('pedido de 2 unidades pago: 2 códigos ativos, no formato, do cliente, com seq 1 e 2, e o pedido fica entregue', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    expect(await codigosDe(order.id)).toHaveLength(0)
    await pagar(c, order)
    const codigos = await codigosDe(order.id)
    expect(codigos).toHaveLength(2)
    expect(codigos.map((x) => x.seq)).toEqual([1, 2])
    for (const x of codigos) {
      expect(x.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
      expect(x).toMatchObject({ status: 'ACTIVE', customerId: c.cliente.id, voucherId: c.voucher.id, businessId: c.b.id, redeemedAt: null })
    }
    expect(new Set(codigos.map((x) => x.code)).size).toBe(2)
    expect(await ordem(order.id)).toMatchObject({ status: 'PAID', fulfillmentStatus: 'DELIVERED' })
    expect(await prisma.auditLog.count({ where: { action: 'order.paid' } })).toBe(1)
  })

  test('o código não vai para a auditoria nem para o log de pagamento', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))
    await pagar(c, order)
    const code = (await codigosDe(order.id))[0]?.code ?? ''
    const logs = JSON.stringify(await prisma.auditLog.findMany())
    expect(logs).not.toContain(code)
    expect(logs).not.toContain(code.replace('-', ''))
  })

  test('a mesma aprovação repetida 3 vezes (mesmo pagamento) deixa 2 códigos', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    const ctx = await sistema()
    const pg = pagamentoMp(order)
    await applyPayment(ctx, order.id, pg)
    const antes = (await codigosDe(order.id)).map((x) => x.code)
    await applyPayment(ctx, order.id, pg)
    await applyPayment(ctx, order.id, pg)
    expect((await codigosDe(order.id)).map((x) => x.code)).toEqual(antes)
    expect(antes).toHaveLength(2)
  })

  test('dois pagamentos aprovados diferentes para o mesmo pedido não geram mais códigos', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order)
    await pagar(c, order, { id: '99001' })
    expect(await codigosDe(order.id)).toHaveLength(2)
  })

  test('uma linha por voucher: cada item recebe os seus códigos', async () => {
    const outroV = await createVoucherDireto(c.b.id, c.parceiro.id, { name: 'Sobremesa', priceCents: 3000, validDays: null })
    const { order } = await pedidoDeVoucher(c.ctxCliente, [...linhaVoucher(2), { voucherId: outroV.id, quantity: 3 }])
    await pagar(c, order)
    const codigos = await codigosDe(order.id)
    expect(codigos.filter((x) => x.voucherId === c.voucher.id)).toHaveLength(2)
    expect(codigos.filter((x) => x.voucherId === outroV.id).map((x) => x.seq)).toEqual([1, 2, 3])
    expect(new Set(codigos.map((x) => x.orderItemId)).size).toBe(2)
    expect(codigos.find((x) => x.voucherId === outroV.id)?.expiresAt).toBeNull()
  })

  test('issueCodesForOrder chamado de novo não cria nada', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order)
    const ctx = await sistema()
    const n = await ctx.db.$transaction((tx) => issueCodesForOrder(tx, ctx, order.id))
    expect(n).toBe(0)
    expect(await codigosDe(order.id)).toHaveLength(2)
  })

  test('colisão de código na conta: gera outro; sem conseguir em 5 tentativas, falha e nada é gravado', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: c.now } })
    const outro = (await pedidoDeVoucher(c.ctxOutro, linhaVoucher(1))).order
    await prisma.voucherCode.create({
      data: { businessId: c.b.id, voucherId: c.voucher.id, orderId: outro.id, orderItemId: (await prisma.orderItem.findFirstOrThrow({ where: { orderId: outro.id } })).id, customerId: c.outro.id, seq: 1, code: 'AAAA-AAAA' },
    })
    const ctx = await sistema()
    const sequencia = ['AAAA-AAAA', 'AAAA-AAAA', 'BBBB-BBBB']
    const gerar = () => sequencia.shift() ?? 'CCCC-CCCC'
    expect(await ctx.db.$transaction((tx) => issueCodesForOrder(tx, ctx, order.id, gerar))).toBe(1)
    expect((await codigosDe(order.id))[0]?.code).toBe('BBBB-BBBB')

    const terceiro = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))).order
    await prisma.order.update({ where: { id: terceiro.id }, data: { status: 'PAID', paidAt: c.now } })
    await expect(ctx.db.$transaction((tx) => issueCodesForOrder(tx, ctx, terceiro.id, () => 'AAAA-AAAA'))).rejects.toThrow()
    expect(await codigosDe(terceiro.id)).toHaveLength(0)
  })

  test('o mesmo texto de código pode existir em contas diferentes', async () => {
    const outra = await cenaVouchers()
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))).order
    const b = (await pedidoDeVoucher(outra.ctxCliente, [{ voucherId: outra.voucher.id, quantity: 1 }])).order
    await pagar(c, a)
    await pagar(outra, b)
    const ca = (await codigosDe(a.id))[0]?.code ?? ''
    await prisma.voucherCode.update({ where: { id: (await codigosDe(b.id))[0]?.id ?? '' }, data: { code: ca } })
    expect(await prisma.voucherCode.count({ where: { code: ca } })).toBe(2)
  })
})

describe('validade', () => {
  test('30 dias em Manaus vencem às 23:59:59.999 locais do 30º dia', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))
    await pagar(c, order)
    const x = (await codigosDe(order.id))[0]
    // Pago em 17/11/2026 (Manaus, UTC-4): vence em 17/12/2026 às 23:59:59.999 locais.
    expect(x?.expiresAt?.toISOString()).toBe('2026-12-18T03:59:59.999Z')
  })

  test('1 dia vence no fim do dia seguinte; sem validade, nunca vence; a conta de pagamento perto da meia-noite local conta o dia local', async () => {
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { validDays: 1 } })
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))
    // 18/11 02:30 UTC = 17/11 22:30 em Manaus: o dia local ainda é 17.
    await pagar(c, order, { now: new Date('2026-11-18T02:30:00Z') })
    expect((await codigosDe(order.id))[0]?.expiresAt?.toISOString()).toBe('2026-11-19T03:59:59.999Z')
  })
})

describe('estorno, cancelamento e pagamento depois de vencer', () => {
  const estornar = async (order: { id: string; totalCents: number }, id = '5001') => {
    const ctx = await sistema()
    return applyPayment(ctx, order.id, { ...pagamentoMp(order, { id }), status: 'refunded' })
  }

  test('estorno anula os códigos ativos, devolve o estoque e não pede atenção quando nada foi usado', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order, { id: '5001' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
    await estornar(order)
    const codigos = await codigosDe(order.id)
    expect(codigos.map((x) => x.status)).toEqual(['VOID', 'VOID'])
    expect(codigos[0]?.voidedAt).not.toBeNull()
    expect(codigos[0]?.voidReason).toBe('Pagamento devolvido no Mercado Pago')
    expect(await ordem(order.id)).toMatchObject({ status: 'CANCELED', attention: null })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
  })

  test('estorno mantém o código usado, anula o outro e marca payment_reversed; só a unidade não usada volta ao estoque', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order, { id: '5001' })
    const [a, b] = await codigosDe(order.id)
    await redeemVoucherCode(c.dono, a?.code ?? '')
    await estornar(order)
    expect((await prisma.voucherCode.findUniqueOrThrow({ where: { id: a?.id ?? '' } })).status).toBe('REDEEMED')
    expect((await prisma.voucherCode.findUniqueOrThrow({ where: { id: b?.id ?? '' } })).status).toBe('VOID')
    expect(await ordem(order.id)).toMatchObject({ status: 'CANCELED', attention: 'payment_reversed' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(9)
  })

  test('o mesmo estorno repetido não devolve o estoque duas vezes', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order, { id: '5001' })
    await estornar(order)
    await estornar(order)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
  })

  test('aprovação atrasada depois do estorno não revive os códigos', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(1))
    const ctx = await sistema()
    const pg = pagamentoMp(order, { id: '5001' })
    await applyPayment(ctx, order.id, pg)
    await applyPayment(ctx, order.id, { ...pg, status: 'refunded' })
    await applyPayment(ctx, order.id, pg)
    expect((await codigosDe(order.id)).map((x) => x.status)).toEqual(['VOID'])
    expect((await ordem(order.id)).status).toBe('CANCELED')
  })

  test('outro pagamento aprovado depois do estorno NÃO reabre o pedido (já foi pago uma vez): fica marcado em dobro e os códigos seguem anulados', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order, { id: '5001' })
    await estornar(order)
    await pagar(c, order, { id: '5002' })
    expect(await ordem(order.id)).toMatchObject({ status: 'CANCELED', attention: 'double_payment' })
    expect((await codigosDe(order.id)).map((x) => x.status)).toEqual(['VOID', 'VOID'])
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
  })

  test('a equipe cancelando o pedido pago anula os códigos e devolve o estoque', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order)
    await cancelOrder(c.dono, order.id, { reason: 'Parceiro fechou' })
    const codigos = await codigosDe(order.id)
    expect(codigos.map((x) => x.status)).toEqual(['VOID', 'VOID'])
    expect(codigos[0]?.voidReason).toBe('Pedido cancelado')
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    await expect(redeemVoucherCode(c.dono, codigos[0]?.code ?? '')).rejects.toMatchObject({ code: 'conflict', reason: 'code_void' })
  })

  test('a equipe cancelando pedido com código já usado: codes_in_use e nada muda', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))
    await pagar(c, order)
    const [a] = await codigosDe(order.id)
    await redeemVoucherCode(c.dono, a?.code ?? '')
    await expect(cancelOrder(c.dono, order.id)).rejects.toMatchObject({ code: 'conflict', reason: 'codes_in_use' })
    expect((await codigosDe(order.id)).map((x) => x.status)).toEqual(['REDEEMED', 'ACTIVE'])
    expect((await ordem(order.id)).status).toBe('PAID')
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
  })

  test('pago depois de vencer: reserva de novo e gera os códigos; sem estoque, marca stock_shortfall e ainda gera os códigos', async () => {
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))).order
    const depois = new Date(c.now.getTime() + 3 * 3600_000)
    await expireOverdueOrders(await sistema(depois))
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    await pagar(c, a, { now: depois })
    expect(await ordem(a.id)).toMatchObject({ status: 'PAID', attention: null })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(8)
    expect(await codigosDe(a.id)).toHaveLength(2)

    const b = (await pedidoDeVoucher(c.ctxOutro, linhaVoucher(1))).order
    await expireOverdueOrders(await sistema(new Date(depois.getTime() + 3 * 3600_000)))
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { stock: 0 } })
    await pagar(c, b, { now: depois })
    expect(await ordem(b.id)).toMatchObject({ status: 'PAID', attention: 'stock_shortfall' })
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(0)
    expect(await codigosDe(b.id)).toHaveLength(1)
  })

  test('pedido misto: estorno devolve o estoque do voucher e o do produto', async () => {
    const p = await produto(c.dono, { stock: 5, priceCents: 2500 })
    const { order } = await createOrder(c.ctxCliente, { lines: [{ productId: p.id, quantity: 1 }, ...linhaVoucher(1)], delivery: { method: 'PICKUP' }, note: null })
    await pagar(c, order, { id: '5001' })
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ fulfillmentStatus: 'PENDING' })
    await estornar(order)
    expect(await estoque(p.id)).toBe(5)
    expect(await estoqueDoVoucher(c.voucher.id)).toBe(10)
    expect((await codigosDe(order.id)).map((x) => x.status)).toEqual(['VOID'])
  })
})

describe('baixa no balcão', () => {
  const comprar = async (n = 1, o: { now?: Date } = {}) => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, linhaVoucher(n))
    await pagar(c, order, o)
    return { order, codigos: await codigosDe(order.id) }
  }

  test('dá baixa uma vez: grava quem e quando, audita sem o código, e a segunda vez é already_redeemed com quando e por quem', async () => {
    const { order, codigos } = await comprar()
    const code = codigos[0]?.code ?? ''
    const r = await redeemVoucherCode(c.gerente, code)
    expect(r).toMatchObject({ status: 'REDEEMED', code, voucher: { name: 'Jantar para dois' }, partnerName: 'Restaurante Sabor do Rio', customer: { name: 'Maria da Silva' }, orderNumber: order.number })
    expect(r.redeemedLabel).toContain('17/11/2026')
    const gravado = await prisma.voucherCode.findUniqueOrThrow({ where: { id: codigos[0]?.id ?? '' } })
    expect(gravado).toMatchObject({ status: 'REDEEMED', redeemedByType: 'MEMBER', redeemedById: c.gerente.actor.kind === 'member' ? c.gerente.actor.userId : '' })
    expect(gravado.redeemedAt?.toISOString()).toBe(c.now.toISOString())
    const aud = await prisma.auditLog.findMany({ where: { action: 'voucher_code.redeemed' } })
    expect(aud).toHaveLength(1)
    expect(aud[0]?.targetId).toBe(codigos[0]?.id)
    expect(JSON.stringify(aud)).not.toContain(code)
    const nome = c.gerente.actor.kind === 'member' ? c.gerente.actor.name : ''
    await expect(redeemVoucherCode(c.dono, code)).rejects.toMatchObject({ code: 'conflict', reason: 'already_redeemed', message: expect.stringContaining(nome) })
    await expect(redeemVoucherCode(c.dono, code)).rejects.toMatchObject({ message: expect.stringContaining('17/11/2026') })
    expect(await prisma.auditLog.count({ where: { action: 'voucher_code.redeemed' } })).toBe(1)
  })

  test('aceita minúsculas, espaços e sem hífen', async () => {
    const { codigos } = await comprar()
    const code = codigos[0]?.code ?? ''
    const r = await redeemVoucherCode(c.dono, ` ${code.replace('-', '').toLowerCase()} `)
    expect(r.status).toBe('REDEEMED')
  })

  test('texto que não é código: validação; código que não existe: not_found', async () => {
    await expect(redeemVoucherCode(c.dono, 'abc')).rejects.toMatchObject({ code: 'validation', fields: { code: expect.any(String) } })
    await expect(redeemVoucherCode(c.dono, 'K7QM-4XH0')).rejects.toMatchObject({ code: 'validation' })
    await expect(redeemVoucherCode(c.dono, 'K7QM-4XHT')).rejects.toMatchObject({ code: 'not_found' })
    await expect(findVoucherCode(c.dono, 'K7QM-4XHT')).rejects.toMatchObject({ code: 'not_found' })
  })

  test('código vencido: code_expired (no instante exato do vencimento e depois); um milissegundo antes ainda vale; o banco não muda de status', async () => {
    const { codigos } = await comprar(2)
    const expira = codigos[0]?.expiresAt as Date
    const noLimite = { ...c.dono, clock: () => expira } as typeof c.dono
    await expect(redeemVoucherCode(noLimite, codigos[0]?.code ?? '')).rejects.toMatchObject({ code: 'conflict', reason: 'code_expired' })
    expect((await prisma.voucherCode.findUniqueOrThrow({ where: { id: codigos[0]?.id ?? '' } })).status).toBe('ACTIVE')
    const antes = { ...c.dono, clock: () => new Date(expira.getTime() - 1) } as typeof c.dono
    expect((await redeemVoucherCode(antes, codigos[1]?.code ?? '')).status).toBe('REDEEMED')
    const view = await findVoucherCode({ ...c.dono, clock: () => new Date(expira.getTime() + 1) } as typeof c.dono, codigos[0]?.code ?? '')
    expect(view.status).toBe('EXPIRED')
  })

  test('código anulado: code_void', async () => {
    const { order, codigos } = await comprar()
    await cancelOrder(c.dono, order.id)
    await expect(redeemVoucherCode(c.dono, codigos[0]?.code ?? '')).rejects.toMatchObject({ code: 'conflict', reason: 'code_void' })
  })

  test('código de outra conta não é encontrado nem baixado, e continua ativo na conta dele', async () => {
    const outra = await cenaVouchers()
    const o = (await pedidoDeVoucher(outra.ctxCliente, [{ voucherId: outra.voucher.id, quantity: 1 }])).order
    await pagar(outra, o)
    const code = (await codigosDe(o.id))[0]?.code ?? ''
    await expect(redeemVoucherCode(c.dono, code)).rejects.toMatchObject({ code: 'not_found' })
    await expect(findVoucherCode(c.dono, code)).rejects.toMatchObject({ code: 'not_found' })
    expect((await codigosDe(o.id))[0]?.status).toBe('ACTIVE')
    expect((await listVoucherCodes(c.dono, { search: code })).items).toEqual([])
  })

  test('profissional e cliente: sem permissão e o código continua ativo', async () => {
    const { codigos } = await comprar()
    const code = codigos[0]?.code ?? ''
    for (const ctx of [c.profissional, c.ctxCliente]) {
      await expect(redeemVoucherCode(ctx, code)).rejects.toMatchObject({ code: 'forbidden', message: 'Você não tem permissão para fazer isso.' })
      await expect(findVoucherCode(ctx, code)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(listVoucherCodes(ctx)).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('ACTIVE')
    expect(await prisma.auditLog.count({ where: { action: 'voucher_code.redeemed' } })).toBe(0)
  })

  test('módulo desligado: baixa, consulta, lista e os códigos do cliente são recusados', async () => {
    const { codigos } = await comprar()
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: false } })
    const code = codigos[0]?.code ?? ''
    await expect(redeemVoucherCode(c.dono, code)).rejects.toMatchObject({ code: 'module_disabled' })
    await expect(findVoucherCode(c.dono, code)).rejects.toMatchObject({ code: 'module_disabled' })
    await expect(listVoucherCodes(c.dono)).rejects.toMatchObject({ code: 'module_disabled' })
    await expect(listMyVoucherCodes(c.ctxCliente)).rejects.toMatchObject({ code: 'module_disabled' })
    await expect(listCodesOfOrder(c.dono, codigos[0]?.orderId ?? '')).rejects.toMatchObject({ code: 'module_disabled' })
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('ACTIVE')
  })
})

describe('listas de códigos', () => {
  test('a equipe filtra por situação, voucher e busca, e pagina por cursor; a EXPIRED é calculada', async () => {
    const outroV = await createVoucherDireto(c.b.id, c.parceiro.id, { name: 'Sobremesa', validDays: 1 })
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(3))).order
    const b = (await pedidoDeVoucher(c.ctxOutro, [{ voucherId: outroV.id, quantity: 2 }])).order
    await pagar(c, a)
    await pagar(c, b)
    const [usado] = await codigosDe(a.id)
    await redeemVoucherCode(c.dono, usado?.code ?? '')
    const todos = await listVoucherCodes(c.dono)
    expect(todos.items).toHaveLength(5)
    expect((await listVoucherCodes(c.dono, { status: 'REDEEMED' })).items.map((x) => x.code)).toEqual([usado?.code])
    expect((await listVoucherCodes(c.dono, { status: 'ACTIVE' })).items).toHaveLength(4)
    expect((await listVoucherCodes(c.dono, { voucherId: outroV.id })).items).toHaveLength(2)
    expect((await listVoucherCodes(c.dono, { search: 'joão' })).items).toHaveLength(2)
    expect((await listVoucherCodes(c.dono, { search: (usado?.code ?? '').toLowerCase().replace('-', '') })).items.map((x) => x.id)).toEqual([usado?.id])
    expect((await listVoucherCodes(c.dono, { search: String(a.number) })).items).toHaveLength(3)
    const p1 = await listVoucherCodes(c.dono, { limit: 2 })
    const p2 = await listVoucherCodes(c.dono, { limit: 2, ...(p1.nextCursor ? { cursor: p1.nextCursor } : {}) })
    const p3 = await listVoucherCodes(c.dono, { limit: 2, ...(p2.nextCursor ? { cursor: p2.nextCursor } : {}) })
    expect([...p1.items, ...p2.items, ...p3.items].map((x) => x.id).sort()).toEqual(todos.items.map((x) => x.id).sort())
    expect(p3.nextCursor).toBeNull()
    // Quarenta horas depois, os de 1 dia de validade viram EXPIRED; os de 30 dias não.
    const amanha = { ...c.dono, clock: () => new Date(c.now.getTime() + 40 * 3600_000) } as typeof c.dono
    expect((await listVoucherCodes(amanha, { status: 'EXPIRED' })).items.map((x) => x.status)).toEqual(['EXPIRED', 'EXPIRED'])
    expect((await listVoucherCodes(amanha, { status: 'ACTIVE' })).items).toHaveLength(2)
    await expect(listVoucherCodes(c.dono, { cursor: 'lixo' })).rejects.toMatchObject({ code: 'validation' })
  })

  test('o cliente vê só os próprios códigos', async () => {
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))).order
    const b = (await pedidoDeVoucher(c.ctxOutro, linhaVoucher(1))).order
    await pagar(c, a)
    await pagar(c, b)
    const meus = await listMyVoucherCodes(c.ctxCliente)
    expect(meus.map((x) => x.id).sort()).toEqual((await codigosDe(a.id)).map((x) => x.id).sort())
    expect(meus.every((x) => x.customer.id === c.cliente.id)).toBe(true)
    expect((await listMyVoucherCodes(c.ctxOutro)).map((x) => x.id)).toEqual((await codigosDe(b.id)).map((x) => x.id))
    await expect(listMyVoucherCodes(c.dono)).rejects.toMatchObject({ code: 'forbidden' })
  })

  test('os códigos de um pedido aparecem no detalhe para a equipe', async () => {
    const a = (await pedidoDeVoucher(c.ctxCliente, linhaVoucher(2))).order
    await pagar(c, a)
    const lista = await listCodesOfOrder(c.dono, a.id)
    expect(lista.map((x) => x.code)).toEqual((await codigosDe(a.id)).map((x) => x.code))
    await expect(listCodesOfOrder(c.profissional, a.id)).rejects.toMatchObject({ code: 'forbidden' })
    const outra = await cenaVouchers()
    await expect(listCodesOfOrder(outra.dono, a.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})
