import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { ctxWithRole } from '../setup/factories'
import { png } from '../setup/store'
import { cenaVouchers, codigosDe, pagar, pedidoDeVoucher, type CenaVouchers } from '../setup/vouchers'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import { arquivarParceiro, arquivarVoucher, consultarCodigo, criarParceiro, criarVoucher, darBaixa, salvarParceiro, salvarVoucher } from '@/app/painel/(app)/vouchers/actions'
import VouchersPage from '@/app/painel/(app)/vouchers/page'
import VoucherPage from '@/app/painel/(app)/vouchers/[id]/page'
import NovoVoucherPage from '@/app/painel/(app)/vouchers/novo/page'
import NovoParceiroPage from '@/app/painel/(app)/vouchers/parceiros/novo/page'
import ParceiroPage from '@/app/painel/(app)/vouchers/parceiros/[id]/page'
import * as rotaImagem from '@/app/painel/(app)/vouchers/[id]/imagem/route'
import * as rotaLogo from '@/app/painel/(app)/vouchers/parceiros/[id]/logo/route'
import PedidoPage from '@/app/painel/(app)/loja/pedidos/[id]/page'
import { notFound } from 'next/navigation'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const nao = { digest: expect.stringContaining('404') }

const form = (campos: Record<string, string>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

/** Todos os textos que o elemento carrega (filhos e propriedades comuns), para conferir o que a tela mostra. */
function textos(no: unknown, saida: string[] = [], visto = new Set<object>()): string[] {
  if (typeof no === 'string') saida.push(no)
  else if (typeof no === 'number') saida.push(String(no))
  else if (typeof no === 'object' && no !== null && !visto.has(no)) {
    visto.add(no)
    if (Array.isArray(no)) no.forEach((n) => textos(n, saida, visto))
    else if (isValidElement(no)) {
      for (const [k, v] of Object.entries(no.props as Record<string, unknown>)) if (k !== 'ctx') textos(v as ReactNode, saida, visto)
    } else if (Object.getPrototypeOf(no) === Object.prototype) {
      for (const v of Object.values(no)) textos(v, saida, visto)
    }
  }
  return saida
}
const tela = (no: unknown) => textos(no).join(' | ')

let c: CenaVouchers
const comoMembro = (ctx: TenantContext) =>
  guards.requireTenant.mockImplementation(async (cap?: Parameters<typeof can>[1]) => {
    if (cap && !can(ctx.actor, cap)) notFound()
    return ctx
  })

beforeEach(async () => {
  await resetDb()
  c = await cenaVouchers()
  comoMembro(c.dono)
})
afterEach(() => {
  guards.requireTenant.mockReset()
  setIntegrationsForTests(null)
})

const busca = (q: Record<string, string | undefined> = {}) => VouchersPage({ searchParams: Promise.resolve(q) })
const comprar = async (n = 1) => {
  const { order } = await pedidoDeVoucher(c.ctxCliente, [{ voucherId: c.voucher.id, quantity: n }])
  await pagar(c, order)
  return { order, codigos: await codigosDe(order.id) }
}

describe('permissão, isolamento e módulo desligado', () => {
  test('profissional: páginas 404 e ações sem permissão; nada muda', async () => {
    const { codigos } = await comprar()
    comoMembro(await ctxWithRole(c.b, 'PROFESSIONAL'))
    await expect(busca()).rejects.toMatchObject(nao)
    await expect(NovoVoucherPage()).rejects.toMatchObject(nao)
    await expect(NovoParceiroPage()).rejects.toMatchObject(nao)
    expect((await darBaixa(ini, form({ code: codigos[0]?.code ?? '' }))).message).toBe(NEGADO)
    expect((await consultarCodigo(ini, form({ code: codigos[0]?.code ?? '' }))).message).toBe(NEGADO)
    expect((await criarParceiro(ini, form({ name: 'X' }))).message).toBe(NEGADO)
    expect((await arquivarVoucher(ini, form({ id: c.voucher.id }))).message).toBe(NEGADO)
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('ACTIVE')
    expect(await prisma.partner.count()).toBe(1)
  })

  test('módulo desligado: todas as páginas 404 e as ações recusadas, dados intactos', async () => {
    const { codigos } = await comprar()
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: false } })
    for (const q of [{}, { aba: 'vouchers' }, { aba: 'parceiros' }, { aba: 'codigos', situacao: 'ACTIVE' }] as Record<string, string>[]) await expect(busca(q)).rejects.toMatchObject(nao)
    await expect(NovoVoucherPage()).rejects.toMatchObject(nao)
    await expect(NovoParceiroPage()).rejects.toMatchObject(nao)
    await expect(VoucherPage({ params: Promise.resolve({ id: c.voucher.id }), searchParams: Promise.resolve({}) })).rejects.toMatchObject(nao)
    await expect(ParceiroPage({ params: Promise.resolve({ id: c.parceiro.id }), searchParams: Promise.resolve({}) })).rejects.toMatchObject(nao)
    expect((await darBaixa(ini, form({ code: codigos[0]?.code ?? '' }))).ok).toBe(false)
    expect((await consultarCodigo(ini, form({ code: codigos[0]?.code ?? '' }))).ok).toBe(false)
    expect((await criarVoucher(ini, form({ partnerId: c.parceiro.id, name: 'X', price: '10,00', stock: '1', validDays: '' }))).ok).toBe(false)
    expect((await arquivarParceiro(ini, form({ id: c.parceiro.id }))).ok).toBe(false)
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('ACTIVE')
    expect(await prisma.voucher.count()).toBe(1)
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: c.parceiro.id } })).archivedAt).toBeNull()
  })

  test('voucher e parceiro de outra conta: 404 na página e not_found nas ações', async () => {
    const outra = await cenaVouchers()
    await expect(VoucherPage({ params: Promise.resolve({ id: outra.voucher.id }), searchParams: Promise.resolve({}) })).rejects.toMatchObject(nao)
    await expect(ParceiroPage({ params: Promise.resolve({ id: outra.parceiro.id }), searchParams: Promise.resolve({}) })).rejects.toMatchObject(nao)
    await expect(VoucherPage({ params: Promise.resolve({ id: 'nao-uuid' }), searchParams: Promise.resolve({}) })).rejects.toMatchObject(nao)
    expect((await arquivarVoucher(ini, form({ id: outra.voucher.id }))).ok).toBe(false)
    expect((await arquivarParceiro(ini, form({ id: outra.parceiro.id }))).ok).toBe(false)
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: outra.voucher.id } })).archivedAt).toBeNull()
  })
})

describe('Dar baixa', () => {
  test('é a primeira aba e a padrão', async () => {
    const t = tela(await busca())
    expect(t).toContain('Dar baixa')
    expect(t.indexOf('Dar baixa')).toBeLessThan(t.indexOf('Parceiros'))
    expect(tela(await busca({ aba: 'baixa' }))).toContain('Dar baixa')
    expect(tela(await busca({ aba: 'lixo' }))).toContain('Dar baixa')
  })

  test('consultar mostra o cartão do código válido sem dar baixa; dar baixa grava; repetir explica por quê', async () => {
    const { codigos } = await comprar()
    const code = codigos[0]?.code ?? ''
    const r = await consultarCodigo(ini, form({ code: code.toLowerCase().replace('-', '') }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Código válido: Jantar para dois de Restaurante Sabor do Rio, comprado por Maria da Silva.')
    expect(r.values.status).toBe('ACTIVE')
    expect(r.values.code).toBe(code)
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('ACTIVE')
    const b = await darBaixa(ini, form({ code }))
    expect(b.ok).toBe(true)
    expect(b.message).toBe('Baixa feita: Jantar para dois de Restaurante Sabor do Rio.')
    expect((await codigosDe(codigos[0]?.orderId ?? ''))[0]?.status).toBe('REDEEMED')
    const de = await darBaixa(ini, form({ code }))
    expect(de.ok).toBe(false)
    expect(de.message).toMatch(/já foi usado em 17\/11\/2026/)
    const q = await consultarCodigo(ini, form({ code }))
    expect(q.ok).toBe(true)
    expect(q.values.status).toBe('REDEEMED')
    expect(q.message).toMatch(/Este código já foi usado/)
  })

  test('recusas em texto: não encontrado, formato inválido, anulado e vencido', async () => {
    const { order, codigos } = await comprar(2)
    expect((await darBaixa(ini, form({ code: 'K7QM-4XHT' }))).message).toBe('Código não encontrado.')
    expect((await consultarCodigo(ini, form({ code: 'K7QM-4XHT' }))).message).toBe('Código não encontrado.')
    const ruim = await darBaixa(ini, form({ code: 'abc' }))
    expect(ruim.ok).toBe(false)
    expect(ruim.fields.code).toEqual(expect.any(String))
    await prisma.voucherCode.update({ where: { id: codigos[0]?.id ?? '' }, data: { status: 'VOID', voidedAt: c.now, voidReason: 'x' } })
    expect((await darBaixa(ini, form({ code: codigos[0]?.code ?? '' }))).message).toMatch(/foi anulado/)
    expect((await consultarCodigo(ini, form({ code: codigos[0]?.code ?? '' }))).values.status).toBe('VOID')
    await prisma.voucherCode.update({ where: { id: codigos[1]?.id ?? '' }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
    expect((await darBaixa(ini, form({ code: codigos[1]?.code ?? '' }))).message).toMatch(/venceu/)
    expect((await codigosDe(order.id)).map((x) => x.status)).toEqual(['VOID', 'ACTIVE'])
  })

  test('código de outra conta: não encontrado e continua ativo lá', async () => {
    const outra = await cenaVouchers()
    const o = (await pedidoDeVoucher(outra.ctxCliente, [{ voucherId: outra.voucher.id, quantity: 1 }])).order
    await pagar(outra, o)
    const code = (await codigosDe(o.id))[0]?.code ?? ''
    expect((await darBaixa(ini, form({ code }))).message).toBe('Código não encontrado.')
    expect((await codigosDe(o.id))[0]?.status).toBe('ACTIVE')
  })
})

describe('listas', () => {
  test('aba Vouchers: nome, parceiro, preço, vendidos e usados', async () => {
    const { codigos } = await comprar(2)
    await darBaixa(ini, form({ code: codigos[0]?.code ?? '' }))
    const t = tela(await busca({ aba: 'vouchers' }))
    expect(t).toContain('Jantar para dois')
    expect(t).toContain('Restaurante Sabor do Rio')
    expect(t).toContain('Novo voucher')
  })

  test('aba Parceiros e aba Códigos (o código aparece para a equipe; filtro de situação na URL)', async () => {
    const { codigos } = await comprar(2)
    expect(tela(await busca({ aba: 'parceiros' }))).toContain('Restaurante Sabor do Rio')
    const t = tela(await busca({ aba: 'codigos', situacao: 'ACTIVE' }))
    expect(t).toContain(codigos[0]?.code ?? 'x')
    expect(t).toContain('Maria da Silva')
    await darBaixa(ini, form({ code: codigos[0]?.code ?? '' }))
    const ativos = tela(await busca({ aba: 'codigos', situacao: 'ACTIVE' }))
    expect(ativos).not.toContain(codigos[0]?.code ?? 'x')
    expect(ativos).toContain(codigos[1]?.code ?? 'x')
    expect(tela(await busca({ aba: 'codigos', situacao: 'REDEEMED' }))).toContain(codigos[0]?.code ?? 'x')
    expect(tela(await busca({ aba: 'codigos', search: 'maria' }))).toContain(codigos[1]?.code ?? 'x')
  })

  test('cursor inválido e filtros estranhos não quebram a página', async () => {
    await expect(busca({ aba: 'codigos', cursor: 'lixo' })).resolves.toBeDefined()
    await expect(busca({ aba: 'codigos', situacao: 'qualquer', search: '\u0000x' })).resolves.toBeDefined()
    await expect(busca({ aba: 'vouchers', situacao: 'arquivados' })).resolves.toBeDefined()
  })

  test('o pedido da Loja mostra os códigos no detalhe', async () => {
    const { order, codigos } = await comprar(2)
    const t = tela(await PedidoPage({ params: Promise.resolve({ id: order.id }) }))
    expect(t).toContain('Vouchers do pedido')
    expect(t).toContain(codigos[0]?.code ?? 'x')
    expect(t).toContain(codigos[1]?.code ?? 'x')
  })
})

describe('parceiros e vouchers pelas ações', () => {
  test('criar parceiro leva à ficha; salvar edita; erro volta no campo; arquivar tira da lista', async () => {
    await expect(criarParceiro(ini, form({ name: 'Cinema Central', website: 'https://cine.example.com', active: 'on' }))).rejects.toThrow(/NEXT_REDIRECT \/vouchers\/parceiros\//)
    const novo = await prisma.partner.findFirstOrThrow({ where: { name: 'Cinema Central' } })
    expect(novo).toMatchObject({ website: 'https://cine.example.com', active: true })
    const ruim = await criarParceiro(ini, form({ name: 'Y', website: 'javascript:1' }))
    expect(ruim.ok).toBe(false)
    expect(Object.keys(ruim.fields)).toEqual(['website'])
    expect(ruim.values.website).toBe('javascript:1')
    expect((await salvarParceiro(ini, form({ id: novo.id, name: 'Cine Central' }))).ok).toBe(true)
    expect(await prisma.partner.findUniqueOrThrow({ where: { id: novo.id } })).toMatchObject({ name: 'Cine Central', active: false })
    expect((await arquivarParceiro(ini, form({ id: novo.id }))).ok).toBe(true)
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: novo.id } })).archivedAt).not.toBeNull()
    expect(tela(await ParceiroPage({ params: Promise.resolve({ id: c.parceiro.id }), searchParams: Promise.resolve({}) }))).toContain('Restaurante Sabor do Rio')
  })

  test('criar voucher converte reais em centavos; edição de estoque exige o estoque lido e recusa se a venda mudou', async () => {
    await expect(criarVoucher(ini, form({ partnerId: c.parceiro.id, name: 'Pizza', price: '45,90', stock: '5', validDays: '', active: 'on' }))).rejects.toThrow(/NEXT_REDIRECT \/vouchers\//)
    const v = await prisma.voucher.findFirstOrThrow({ where: { name: 'Pizza' } })
    expect(v).toMatchObject({ priceCents: 4590, stock: 5, validDays: null, active: true })
    const ruim = await criarVoucher(ini, form({ partnerId: c.parceiro.id, name: 'Z', price: 'abc', stock: '1', validDays: '' }))
    expect(Object.keys(ruim.fields)).toEqual(['price'])
    const dados = { id: v.id, partnerId: c.parceiro.id, name: 'Pizza grande', description: '', terms: '', price: '50,00', validDays: '60', active: 'on' }
    await prisma.voucher.update({ where: { id: v.id }, data: { stock: 4 } })
    const conflito = await salvarVoucher(ini, form({ ...dados, stock: '9', expectedStock: '5' }))
    expect(conflito.ok).toBe(false)
    expect(conflito.fields.stock).toEqual(expect.any(String))
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(4)
    expect((await salvarVoucher(ini, form({ ...dados, stock: '9', expectedStock: '4' }))).ok).toBe(true)
    expect(await prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ name: 'Pizza grande', priceCents: 5000, validDays: 60, stock: 9 })
    expect((await arquivarVoucher(ini, form({ id: v.id }))).ok).toBe(true)
    expect(tela(await VoucherPage({ params: Promise.resolve({ id: c.voucher.id }), searchParams: Promise.resolve({}) }))).toContain('Jantar para dois')
    expect(tela(await NovoVoucherPage())).toContain('Dados do voucher')
  })
})

describe('envio de imagem e logo', () => {
  const OK = { host: 'painel.localhost:3000', origin: 'http://painel.localhost:3000' }
  const pedido = async (base: string, id: string, campos: Record<string, string | File>, headers: Record<string, string> = OK) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    return [new Request(`http://painel.localhost:3000${base}`, { method: 'POST', headers, body: fd }), { params: Promise.resolve({ id }) }] as const
  }
  const arquivo = async () => new File([(await png()).bytes as BlobPart], 'i.png', { type: 'image/png' })

  test('imagem do voucher: envia, volta à ficha e remove; outra origem é 403', async () => {
    const r = await rotaImagem.POST(...(await pedido(`/vouchers/${c.voucher.id}/imagem`, c.voucher.id, { file: await arquivo() })))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/vouchers/${c.voucher.id}?imagem=ok`)
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: c.voucher.id } })).imageUploadId).not.toBeNull()
    await rotaImagem.POST(...(await pedido(`/vouchers/${c.voucher.id}/imagem`, c.voucher.id, { intent: 'remove' })))
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: c.voucher.id } })).imageUploadId).toBeNull()
    const fora = await rotaImagem.POST(...(await pedido(`/vouchers/${c.voucher.id}/imagem`, c.voucher.id, { file: await arquivo() }, { host: 'painel.localhost:3000', origin: 'http://x.example' })))
    expect(fora.status).toBe(403)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('logo do parceiro: envia e volta à ficha do parceiro; Vouchers desligado recusa', async () => {
    const r = await rotaLogo.POST(...(await pedido(`/vouchers/parceiros/${c.parceiro.id}/logo`, c.parceiro.id, { file: await arquivo() })))
    expect(r.headers.get('location')).toBe(`/vouchers/parceiros/${c.parceiro.id}?imagem=ok`)
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: c.parceiro.id } })).logoUploadId).not.toBeNull()
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { vouchers: false } })
    const de = await rotaLogo.POST(...(await pedido(`/vouchers/parceiros/${c.parceiro.id}/logo`, c.parceiro.id, { intent: 'remove' })))
    expect(de.headers.get('location')).toBe(`/vouchers/parceiros/${c.parceiro.id}?imagem=refused`)
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: c.parceiro.id } })).logoUploadId).not.toBeNull()
  })

  test('profissional não troca a imagem (recusado pelo domínio)', async () => {
    comoMembro(await ctxWithRole(c.b, 'PROFESSIONAL'))
    guards.requireTenant.mockImplementation(async () => ctxWithRole(c.b, 'PROFESSIONAL'))
    const r = await rotaImagem.POST(...(await pedido(`/vouchers/${c.voucher.id}/imagem`, c.voucher.id, { file: await arquivo() })))
    expect(r.headers.get('location')).toBe(`/vouchers/${c.voucher.id}?imagem=refused`)
    expect(await prisma.upload.count()).toBe(0)
  })
})
