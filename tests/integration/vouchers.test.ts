import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { archivePartner, createPartner, listPartners, setPartnerLogo, updatePartner } from '@/server/domain/vouchers/partners'
import { archiveVoucher, createVoucher, getPublicVoucher, listPublicVouchers, listVouchers, setVoucherImage, updateVoucher } from '@/server/domain/vouchers/vouchers'
import { resetDb } from '../setup/db'
import { png } from '../setup/store'
import { cenaVouchers, dadosDoParceiro, dadosDoVoucher, pagar, pedidoDeVoucher, type CenaVouchers } from '../setup/vouchers'
import { redeemVoucherCode } from '@/server/domain/vouchers/codes'

const SEM_PERMISSAO = 'Você não tem permissão para fazer isso.'

beforeEach(resetDb)

let c: CenaVouchers
beforeEach(async () => {
  c = await cenaVouchers()
})

describe('parceiros', () => {
  test('dono cria, lista, edita e arquiva; arquivado só aparece com includeArchived', async () => {
    const p = await createPartner(c.dono, dadosDoParceiro({ name: 'Cinema Central', description: null, address: null, phone: null, website: null }))
    expect(p).toMatchObject({ name: 'Cinema Central', active: true, voucherCount: 0, logoUrl: null, archivedAt: null })
    expect((await listPartners(c.gerente)).map((x) => x.name).sort()).toEqual(['Cinema Central', 'Restaurante Sabor do Rio'])
    const e = await updatePartner(c.gerente, p.id, { name: 'Cine Central', phone: '(92) 3000-0000' })
    expect(e).toMatchObject({ name: 'Cine Central', phone: '(92) 3000-0000' })
    await archivePartner(c.dono, p.id)
    expect((await listPartners(c.dono)).map((x) => x.id)).not.toContain(p.id)
    expect((await listPartners(c.dono, { includeArchived: true })).find((x) => x.id === p.id)?.archivedAt).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { action: { in: ['partner.created', 'partner.updated', 'partner.archived'] } } })).toBe(3)
  })

  test('conta o número de vouchers não arquivados', async () => {
    await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Outro' }))
    const arquivado = await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Velho' }))
    await archiveVoucher(c.dono, arquivado.id)
    expect((await listPartners(c.dono)).find((x) => x.id === c.parceiro.id)?.voucherCount).toBe(2)
  })

  test('valida nome vazio, site sem http(s) e textos longos', async () => {
    await expect(createPartner(c.dono, dadosDoParceiro({ name: '  ' }))).rejects.toMatchObject({ code: 'validation', fields: { name: expect.any(String) } })
    await expect(createPartner(c.dono, dadosDoParceiro({ website: 'javascript:alert(1)' }))).rejects.toMatchObject({ code: 'validation', fields: { website: expect.any(String) } })
    await expect(createPartner(c.dono, dadosDoParceiro({ description: 'x'.repeat(1001) }))).rejects.toMatchObject({ code: 'validation' })
    expect(await prisma.partner.count({ where: { businessId: c.b.id } })).toBe(1)
  })

  test('profissional e cliente não gerenciam parceiros; nada muda', async () => {
    for (const ctx of [c.profissional, c.ctxCliente]) {
      await expect(createPartner(ctx, dadosDoParceiro())).rejects.toMatchObject({ code: 'forbidden', message: SEM_PERMISSAO })
      await expect(listPartners(ctx)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(updatePartner(ctx, c.parceiro.id, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(archivePartner(ctx, c.parceiro.id)).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect(await prisma.partner.findUniqueOrThrow({ where: { id: c.parceiro.id } })).toMatchObject({ name: 'Restaurante Sabor do Rio', archivedAt: null })
  })

  test('parceiro de outra conta: not_found (e a outra conta não é alterada)', async () => {
    const outra = await cenaVouchers()
    await expect(updatePartner(c.dono, outra.parceiro.id, { name: 'Invadido' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(archivePartner(c.dono, outra.parceiro.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(setPartnerLogo(c.dono, outra.parceiro.id, null)).rejects.toMatchObject({ code: 'not_found' })
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: outra.parceiro.id } })).name).toBe('Restaurante Sabor do Rio')
    expect((await listPartners(c.dono)).map((x) => x.id)).toEqual([c.parceiro.id])
    await expect(updatePartner(c.dono, 'nao-uuid', { name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('logo: envia, troca (o arquivo antigo some) e remove', async () => {
    const a = await setPartnerLogo(c.dono, c.parceiro.id, await png())
    expect(a.logoUrl).toMatch(/^\/arquivos\//)
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(1)
    await setPartnerLogo(c.dono, c.parceiro.id, await png(900, 500))
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(1)
    const sem = await setPartnerLogo(c.dono, c.parceiro.id, null)
    expect(sem.logoUrl).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(0)
    await expect(setPartnerLogo(c.dono, c.parceiro.id, { bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ code: 'validation', details: { imageCode: 'not_an_image' } })
    await expect(setPartnerLogo(c.profissional, c.parceiro.id, await png())).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('vouchers', () => {
  test('dono cria, edita, lista com vendidos e usados e arquiva', async () => {
    const v = await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Pizza grande', priceCents: 4500, stock: 5, validDays: null }))
    expect(v).toMatchObject({ name: 'Pizza grande', priceCents: 4500, stock: 5, validDays: null, partnerName: 'Restaurante Sabor do Rio', sold: 0, redeemed: 0, imageUrl: null, archivedAt: null })
    const e = await updateVoucher(c.gerente, v.id, { priceCents: 5000, validDays: 60, terms: null })
    expect(e).toMatchObject({ priceCents: 5000, validDays: 60, terms: null })
    await archiveVoucher(c.dono, v.id)
    expect((await listVouchers(c.dono)).map((x) => x.id)).not.toContain(v.id)
    expect((await listVouchers(c.dono, { situation: 'archived' })).map((x) => x.id)).toEqual([v.id])
  })

  test('a ordem de exibição cresce e a lista filtra por parceiro e situação', async () => {
    const outroParceiro = await createPartner(c.dono, dadosDoParceiro({ name: 'Spa Lagoa' }))
    const a = await createVoucher(c.dono, dadosDoVoucher(outroParceiro.id, { name: 'Massagem', active: false }))
    const b = await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Sobremesa' }))
    expect(b.displayOrder).toBeGreaterThan(a.displayOrder)
    expect((await listVouchers(c.dono, { partnerId: outroParceiro.id })).map((x) => x.id)).toEqual([a.id])
    expect((await listVouchers(c.dono, { situation: 'inactive' })).map((x) => x.id)).toEqual([a.id])
    expect((await listVouchers(c.dono, { situation: 'active' })).map((x) => x.name).sort()).toEqual(['Jantar para dois', 'Sobremesa'])
  })

  test('vendidos e usados contam os códigos vivos e os usados (anulados não contam)', async () => {
    const { order } = await pedidoDeVoucher(c.ctxCliente, [{ voucherId: c.voucher.id, quantity: 3 }])
    await pagar(c, order)
    const codigos = await prisma.voucherCode.findMany({ where: { orderId: order.id }, orderBy: { seq: 'asc' } })
    await redeemVoucherCode(c.dono, codigos[0]?.code ?? '')
    await prisma.voucherCode.update({ where: { id: codigos[2]?.id ?? '' }, data: { status: 'VOID', voidedAt: c.now, voidReason: 'teste' } })
    const v = (await listVouchers(c.dono)).find((x) => x.id === c.voucher.id)
    expect(v).toMatchObject({ sold: 2, redeemed: 1 })
  })

  test('mudar o estoque exige o estoque lido: sem ele é recusado e, se uma venda mudou, é conflict', async () => {
    await expect(updateVoucher(c.dono, c.voucher.id, { stock: 3 })).rejects.toMatchObject({ code: 'validation', fields: { stock: expect.any(String) } })
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { stock: 7 } })
    await expect(updateVoucher(c.dono, c.voucher.id, { stock: 3, expectedStock: 10 })).rejects.toMatchObject({ code: 'conflict', reason: 'changed' })
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: c.voucher.id } })).stock).toBe(7)
    expect((await updateVoucher(c.dono, c.voucher.id, { stock: 3, expectedStock: 7 })).stock).toBe(3)
  })

  test('validações: preço, estoque, validade e parceiro', async () => {
    const base = dadosDoVoucher(c.parceiro.id)
    for (const ruim of [{ priceCents: 0 }, { priceCents: -5 }, { priceCents: 10.5 }, { stock: -1 }, { stock: 100_001 }, { validDays: 0 }, { validDays: 731 }, { validDays: 1.5 }, { name: ' ' }]) {
      await expect(createVoucher(c.dono, { ...base, ...ruim })).rejects.toMatchObject({ code: 'validation' })
    }
    await expect(createVoucher(c.dono, { ...base, validDays: 730, stock: 100_000 })).resolves.toMatchObject({ validDays: 730, stock: 100_000 })
    expect(await prisma.voucher.count({ where: { businessId: c.b.id } })).toBe(2)
  })

  test('voucher só de parceiro ativo, não arquivado e da própria conta', async () => {
    const inativo = await createPartner(c.dono, dadosDoParceiro({ name: 'Parado', active: false }))
    await expect(createVoucher(c.dono, dadosDoVoucher(inativo.id))).rejects.toMatchObject({ code: 'validation', fields: { partnerId: expect.any(String) } })
    const arquivado = await createPartner(c.dono, dadosDoParceiro({ name: 'Velho' }))
    await archivePartner(c.dono, arquivado.id)
    await expect(createVoucher(c.dono, dadosDoVoucher(arquivado.id))).rejects.toMatchObject({ code: 'validation' })
    const outra = await cenaVouchers()
    await expect(createVoucher(c.dono, dadosDoVoucher(outra.parceiro.id))).rejects.toMatchObject({ code: 'validation', fields: { partnerId: expect.any(String) } })
    await expect(updateVoucher(c.dono, c.voucher.id, { partnerId: outra.parceiro.id })).rejects.toMatchObject({ code: 'validation' })
    expect(await prisma.voucher.count({ where: { businessId: c.b.id } })).toBe(1)
  })

  test('voucher da outra conta: not_found', async () => {
    const outra = await cenaVouchers()
    await expect(updateVoucher(c.dono, outra.voucher.id, { name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(archiveVoucher(c.dono, outra.voucher.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(setVoucherImage(c.dono, outra.voucher.id, null)).rejects.toMatchObject({ code: 'not_found' })
    expect((await listVouchers(c.dono)).map((x) => x.id)).toEqual([c.voucher.id])
  })

  test('profissional e cliente não gerenciam vouchers', async () => {
    for (const ctx of [c.profissional, c.ctxCliente]) {
      await expect(createVoucher(ctx, dadosDoVoucher(c.parceiro.id))).rejects.toMatchObject({ code: 'forbidden', message: SEM_PERMISSAO })
      await expect(listVouchers(ctx)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(updateVoucher(ctx, c.voucher.id, { name: 'X' })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(archiveVoucher(ctx, c.voucher.id)).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: c.voucher.id } })).name).toBe('Jantar para dois')
  })

  test('imagem: envia, troca e remove sem deixar arquivo órfão', async () => {
    const a = await setVoucherImage(c.dono, c.voucher.id, await png())
    expect(a.imageUrl).toMatch(/^\/arquivos\//)
    await setVoucherImage(c.dono, c.voucher.id, await png(700, 700))
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(1)
    expect((await setVoucherImage(c.dono, c.voucher.id, null)).imageUrl).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(0)
  })
})

describe('módulo desligado: o domínio recusa tudo e os dados ficam', () => {
  test('cada função recusa com module_disabled', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: false } })
    const nao = { code: 'module_disabled' }
    await expect(listPartners(c.dono)).rejects.toMatchObject(nao)
    await expect(createPartner(c.dono, dadosDoParceiro())).rejects.toMatchObject(nao)
    await expect(updatePartner(c.dono, c.parceiro.id, { name: 'X' })).rejects.toMatchObject(nao)
    await expect(archivePartner(c.dono, c.parceiro.id)).rejects.toMatchObject(nao)
    await expect(setPartnerLogo(c.dono, c.parceiro.id, null)).rejects.toMatchObject(nao)
    await expect(listVouchers(c.dono)).rejects.toMatchObject(nao)
    await expect(createVoucher(c.dono, dadosDoVoucher(c.parceiro.id))).rejects.toMatchObject(nao)
    await expect(updateVoucher(c.dono, c.voucher.id, { name: 'X' })).rejects.toMatchObject(nao)
    await expect(archiveVoucher(c.dono, c.voucher.id)).rejects.toMatchObject(nao)
    await expect(setVoucherImage(c.dono, c.voucher.id, null)).rejects.toMatchObject(nao)
    await expect(listPublicVouchers(c.ctxCliente)).rejects.toMatchObject(nao)
    await expect(getPublicVoucher(c.ctxCliente, c.voucher.id)).rejects.toMatchObject(nao)
    expect(await prisma.voucher.count({ where: { businessId: c.b.id } })).toBe(1)
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: true } })
    expect(await listVouchers(c.dono)).toHaveLength(1)
  })
})

describe('vitrine do app', () => {
  test('só o que está à venda, sem estoque nem dados internos, com o parceiro', async () => {
    await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Inativo', active: false }))
    const arq = await createVoucher(c.dono, dadosDoVoucher(c.parceiro.id, { name: 'Arquivado' }))
    await archiveVoucher(c.dono, arq.id)
    const parado = await createPartner(c.dono, dadosDoParceiro({ name: 'Parado' }))
    const doParado = await createVoucher(c.dono, dadosDoVoucher(parado.id, { name: 'Do parceiro parado' }))
    await updatePartner(c.dono, parado.id, { active: false })
    const lista = await listPublicVouchers(c.ctxCliente)
    expect(lista.map((v) => v.name)).toEqual(['Jantar para dois'])
    const v = lista[0]
    expect(v).toMatchObject({ id: c.voucher.id, priceCents: 12000, validDays: 30, available: true, maxQuantity: 10, terms: 'Válido de segunda a quinta. Não acumula.', partner: { name: 'Restaurante Sabor do Rio', address: 'Rua das Flores, 100 - Centro', phone: '(92) 99999-0000', website: 'https://sabordorio.example.com', logoUrl: null } })
    expect(Object.keys(v ?? {})).not.toContain('stock')
    await expect(getPublicVoucher(c.ctxCliente, doParado.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getPublicVoucher(c.ctxCliente, arq.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  test('estoque zero: indisponível; estoque grande: no máximo 99 por pedido', async () => {
    await updateVoucher(c.dono, c.voucher.id, { stock: 0, expectedStock: 10 })
    expect(await getPublicVoucher(c.ctxCliente, c.voucher.id)).toMatchObject({ available: false, maxQuantity: 0 })
    await prisma.voucher.update({ where: { id: c.voucher.id }, data: { stock: 5000 } })
    expect(await getPublicVoucher(c.ctxCliente, c.voucher.id)).toMatchObject({ available: true, maxQuantity: 99 })
  })

  test('imagens saem com endereço absoluto para o app', async () => {
    await setVoucherImage(c.dono, c.voucher.id, await png())
    await setPartnerLogo(c.dono, c.parceiro.id, await png())
    const v = await getPublicVoucher(c.ctxCliente, c.voucher.id)
    expect(v.imageUrl).toMatch(/^https?:\/\/.+\/arquivos\//)
    expect(v.partner.logoUrl).toMatch(/^https?:\/\/.+\/arquivos\//)
  })

  test('voucher de outra conta não aparece nem abre', async () => {
    const outra = await cenaVouchers()
    expect((await listPublicVouchers(c.ctxCliente)).map((v) => v.id)).toEqual([c.voucher.id])
    await expect(getPublicVoucher(c.ctxCliente, outra.voucher.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getPublicVoucher(c.ctxCliente, 'nao-uuid')).rejects.toMatchObject({ code: 'not_found' })
  })
})
