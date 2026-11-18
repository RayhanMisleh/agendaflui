import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { createCategory } from '@/server/domain/store/categories'
import { addProductImage, createProduct } from '@/server/domain/store/products'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness } from '../setup/factories'
import { dadosDoProduto, png } from '../setup/store'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import {
  ajustarEstoque,
  arquivarCategoria,
  arquivarProduto,
  criarCategoria,
  criarProduto,
  moverCategoria,
  renomearCategoria,
  salvarConfiguracoes,
  salvarProduto,
} from '@/app/painel/(app)/loja/actions'
import LojaPage from '@/app/painel/(app)/loja/page'
import ProdutoPage from '@/app/painel/(app)/loja/produtos/[id]/page'
import NovoProdutoPage from '@/app/painel/(app)/loja/produtos/novo/page'
import * as rotaImagens from '@/app/painel/(app)/loja/produtos/[id]/imagens/route'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'

function form(campos: Record<string, string | File>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  businessId = b.id
  await prisma.businessModules.update({ where: { businessId }, data: { store: true } })
  dono = await ctxWithRole(b, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
})
afterEach(() => guards.requireTenant.mockReset())

const produtos = () => prisma.product.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } })
const CAMPOS = { name: 'Shampoo', description: '', price: '19,90', promoPrice: '', stock: '10', categoryId: '', weightGrams: '', lengthCm: '', heightCm: '', widthCm: '' }

describe('produtos', () => {
  test('criar converte "19,90" em 1990 centavos, grava e leva à ficha', async () => {
    await expect(criarProduto(ini, form({ ...CAMPOS, active: 'on' }))).rejects.toThrow(/NEXT_REDIRECT \/loja\/produtos\//)
    const [p] = await produtos()
    expect(p).toMatchObject({ name: 'Shampoo', priceCents: 1990, promoPriceCents: null, stock: 10, active: true, categoryId: null })
  })

  test('promoção e dimensões entram; preço e promoção em formatos comuns', async () => {
    await expect(criarProduto(ini, form({ ...CAMPOS, price: '1.250,00', promoPrice: '999,90', weightGrams: '500', lengthCm: '10', heightCm: '5', widthCm: '15' }))).rejects.toThrow(/NEXT_REDIRECT/)
    const [p] = await produtos()
    expect(p).toMatchObject({ priceCents: 125000, promoPriceCents: 99990, weightGrams: 500, lengthCm: 10, heightCm: 5, widthCm: 15, active: false })
  })

  test('erros voltam no campo do formulário, com o digitado, e nada é gravado', async () => {
    const promo = await criarProduto(ini, form({ ...CAMPOS, promoPrice: '19,90' }))
    expect(promo.ok).toBe(false)
    expect(Object.keys(promo.fields)).toEqual(['promoPrice'])
    expect(promo.values.price).toBe('19,90')
    expect(Object.keys((await criarProduto(ini, form({ ...CAMPOS, price: '' }))).fields)).toEqual(['price'])
    expect(Object.keys((await criarProduto(ini, form({ ...CAMPOS, price: 'abc' }))).fields)).toEqual(['price'])
    expect(Object.keys((await criarProduto(ini, form({ ...CAMPOS, stock: '1,5' }))).fields)).toEqual(['stock'])
    expect(Object.keys((await criarProduto(ini, form({ ...CAMPOS, weightGrams: 'x' }))).fields)).toEqual(['weightGrams'])
    expect(await produtos()).toHaveLength(0)
  })

  test('profissional criando produto: "sem permissão" e nada é gravado', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    const r = await criarProduto(ini, form(CAMPOS))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(NEGADO)
    expect(await produtos()).toHaveLength(0)
  })

  test('módulo desligado: a ação recusa e nada é gravado', async () => {
    await prisma.businessModules.update({ where: { businessId }, data: { store: false } })
    const r = await criarProduto(ini, form(CAMPOS))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Loja/)
    expect(await produtos()).toHaveLength(0)
  })

  test('salvar muda os dados sem tocar no estoque, e arquivar tira da lista', async () => {
    const p = await createProduct(dono, dadosDoProduto({ stock: 10 }))
    await prisma.product.update({ where: { id: p.id }, data: { stock: 4 } })
    const r = await salvarProduto(ini, form({ ...CAMPOS, id: p.id, name: 'Shampoo 2', price: '30,00', active: 'on' }))
    expect(r.ok).toBe(true)
    expect((await produtos())[0]).toMatchObject({ name: 'Shampoo 2', priceCents: 3000, stock: 4 })
    expect((await arquivarProduto(ini, form({ id: p.id }))).ok).toBe(true)
    expect((await produtos())[0]?.archivedAt).not.toBeNull()
  })

  test('ajustar estoque com sinal e motivo; erros no campo certo', async () => {
    const p = await createProduct(dono, dadosDoProduto({ stock: 3 }))
    expect((await ajustarEstoque(ini, form({ id: p.id, delta: '+5', reason: 'Chegou caixa' }))).ok).toBe(true)
    expect((await ajustarEstoque(ini, form({ id: p.id, delta: '-2', reason: 'Quebra' }))).ok).toBe(true)
    expect((await produtos())[0]?.stock).toBe(6)
    const demais = await ajustarEstoque(ini, form({ id: p.id, delta: '-50', reason: 'Quebra' }))
    expect(Object.keys(demais.fields)).toEqual(['delta'])
    expect(Object.keys((await ajustarEstoque(ini, form({ id: p.id, delta: 'abc', reason: 'x' }))).fields)).toEqual(['delta'])
    expect(Object.keys((await ajustarEstoque(ini, form({ id: p.id, delta: '1', reason: '' }))).fields)).toEqual(['reason'])
    expect((await produtos())[0]?.stock).toBe(6)
  })

  test('profissional não ajusta estoque', async () => {
    const p = await createProduct(dono, dadosDoProduto({ stock: 3 }))
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await ajustarEstoque(ini, form({ id: p.id, delta: '5', reason: 'Entrada' }))).message).toBe(NEGADO)
    expect((await produtos())[0]?.stock).toBe(3)
  })
})

describe('categorias', () => {
  test('criar, renomear, mover e arquivar', async () => {
    expect((await criarCategoria(ini, form({ name: 'Cabelo' }))).ok).toBe(true)
    expect((await criarCategoria(ini, form({ name: 'Barba' }))).ok).toBe(true)
    const cats = () => prisma.productCategory.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } })
    const [a, b] = await cats()
    expect((await renomearCategoria(ini, form({ id: b?.id ?? '', name: 'Barbearia' }))).ok).toBe(true)
    expect((await moverCategoria(ini, form({ id: b?.id ?? '', direction: 'up' }))).ok).toBe(true)
    expect((await cats()).map((x) => x.name)).toEqual(['Barbearia', 'Cabelo'])
    expect((await arquivarCategoria(ini, form({ id: a?.id ?? '' }))).ok).toBe(true)
    expect((await cats()).find((x) => x.id === a?.id)?.archivedAt).not.toBeNull()
  })

  test('nome repetido volta no campo name; profissional recusado', async () => {
    await criarCategoria(ini, form({ name: 'Cabelo' }))
    const r = await criarCategoria(ini, form({ name: 'cabelo' }))
    expect(Object.keys(r.fields)).toEqual(['name'])
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await criarCategoria(ini, form({ name: 'Outra' }))).message).toBe(NEGADO)
    expect(await prisma.productCategory.count()).toBe(1)
  })
})

describe('configurações', () => {
  const CONFIG = { version: '0', pickupEnabled: 'on', pickupInstructions: 'Na recepção', originPostalCode: '', weightGrams: '1000', lengthCm: '20', heightCm: '10', widthCm: '30', paymentWindowMin: '60' }

  test('salva (versão 0 cria) e a versão velha vira a mensagem de conflito', async () => {
    const r = await salvarConfiguracoes(ini, form(CONFIG))
    expect(r.ok).toBe(true)
    expect(await prisma.storeSettings.findUniqueOrThrow({ where: { businessId } })).toMatchObject({ pickupEnabled: true, shippingEnabled: false, pickupInstructions: 'Na recepção', version: 1 })
    const velha = await salvarConfiguracoes(ini, form({ ...CONFIG, paymentWindowMin: '90' }))
    expect(velha.ok).toBe(false)
    expect(velha.message).toBe('Alguém mudou estas configurações agora. Recarregue para ver.')
    expect(velha.values.paymentWindowMin).toBe('90')
  })

  test('entrega sem CEP de origem erra no campo; as duas formas desligadas também', async () => {
    const semCep = await salvarConfiguracoes(ini, form({ ...CONFIG, shippingEnabled: 'on' }))
    expect(Object.keys(semCep.fields)).toEqual(['originPostalCode'])
    // Caixa desmarcada não vai no formulário.
    const nenhuma = await salvarConfiguracoes(ini, form(Object.fromEntries(Object.entries(CONFIG).filter(([k]) => k !== 'pickupEnabled'))))
    expect(nenhuma.ok).toBe(false)
    expect(await prisma.storeSettings.count()).toBe(0)
  })

  test('número fora do formato volta no campo', async () => {
    const r = await salvarConfiguracoes(ini, form({ ...CONFIG, paymentWindowMin: 'abc' }))
    expect(Object.keys(r.fields)).toEqual(['paymentWindowMin'])
  })

  test('profissional recusado', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await salvarConfiguracoes(ini, form(CONFIG))).message).toBe(NEGADO)
    expect(await prisma.storeSettings.count()).toBe(0)
  })
})

describe('páginas', () => {
  const q = Promise.resolve({})
  test('com o módulo desligado cada página responde 404', async () => {
    const p = await createProduct(dono, dadosDoProduto())
    await prisma.businessModules.update({ where: { businessId }, data: { store: false } })
    const nao = { digest: expect.stringContaining('404') }
    await expect(LojaPage({ searchParams: q })).rejects.toMatchObject(nao)
    await expect(LojaPage({ searchParams: Promise.resolve({ aba: 'categorias' }) })).rejects.toMatchObject(nao)
    await expect(LojaPage({ searchParams: Promise.resolve({ aba: 'configuracoes' }) })).rejects.toMatchObject(nao)
    await expect(NovoProdutoPage()).rejects.toMatchObject(nao)
    await expect(ProdutoPage({ params: Promise.resolve({ id: p.id }), searchParams: q })).rejects.toMatchObject(nao)
  })

  test('as páginas montam com dados, e produto de outra conta ou inexistente dá 404', async () => {
    const cat = await createCategory(dono, { name: 'Cabelo' })
    const p = await createProduct(dono, dadosDoProduto({ categoryId: cat.id }))
    await addProductImage(dono, p.id, await png())
    for (const aba of ['produtos', 'categorias', 'configuracoes', 'lixo']) await expect(LojaPage({ searchParams: Promise.resolve({ aba, search: 'sha', situacao: 'ativos', categoria: cat.id }) })).resolves.toBeTruthy()
    await expect(LojaPage({ searchParams: Promise.resolve({ aba: 'produtos', cursor: 'lixo', situacao: '%00', categoria: 'nao-uuid' }) })).resolves.toBeTruthy()
    await expect(NovoProdutoPage()).resolves.toBeTruthy()
    await expect(ProdutoPage({ params: Promise.resolve({ id: p.id }), searchParams: Promise.resolve({ imagem: 'ok' }) })).resolves.toBeTruthy()
    const outro = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: outro.id }, data: { store: true } })
    const alheio = await createProduct(await ctxWithRole(outro, 'OWNER'), dadosDoProduto())
    const nao = { digest: expect.stringContaining('404') }
    await expect(ProdutoPage({ params: Promise.resolve({ id: alheio.id }), searchParams: q })).rejects.toMatchObject(nao)
    await expect(ProdutoPage({ params: Promise.resolve({ id: 'nao-uuid' }), searchParams: q })).rejects.toMatchObject(nao)
  })
})

describe('rota de imagens do produto', () => {
  const OK = { host: 'painel.localhost:3000', origin: 'http://painel.localhost:3000' }
  let productId: string
  beforeEach(async () => {
    productId = (await createProduct(dono, dadosDoProduto())).id
  })
  async function enviar(campos: Record<string, string | File>, headers: Record<string, string> = OK) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    return rotaImagens.POST(new Request(`http://painel.localhost:3000/loja/produtos/${productId}/imagens`, { method: 'POST', headers, body: fd }), { params: Promise.resolve({ id: productId }) })
  }
  const arquivo = async () => new File([(await png()).bytes as BlobPart], 'i.png', { type: 'image/png' })
  const imagens = () => prisma.productImage.findMany({ where: { productId }, orderBy: { position: 'asc' } })

  test('a rota só aceita POST', () => {
    expect(Object.keys(rotaImagens)).toEqual(['POST'])
  })

  test('envia, sobe, desce e remove, sempre voltando à ficha com ?imagem=ok (303)', async () => {
    const volta = `/loja/produtos/${productId}?imagem=`
    for (let i = 0; i < 3; i++) {
      const r = await enviar({ file: await arquivo() })
      expect(r.status).toBe(303)
      expect(r.headers.get('location')).toBe(`${volta}ok`)
    }
    const [a, b, c] = await imagens()
    expect((await enviar({ intent: 'up', imageId: c?.id ?? '' })).headers.get('location')).toBe(`${volta}ok`)
    expect((await imagens()).map((i) => i.id)).toEqual([a?.id, c?.id, b?.id])
    await enviar({ intent: 'down', imageId: a?.id ?? '' })
    expect((await imagens()).map((i) => i.id)).toEqual([c?.id, a?.id, b?.id])
    await enviar({ intent: 'remove', imageId: a?.id ?? '' })
    expect(await imagens()).toHaveLength(2)
    expect(await prisma.upload.count({ where: { businessId } })).toBe(2)
  })

  test('sem arquivo, sétima imagem, imagem de outro produto e intent desconhecida voltam com o código certo', async () => {
    const volta = `/loja/produtos/${productId}?imagem=`
    expect((await enviar({})).headers.get('location')).toBe(`${volta}no_file`)
    expect((await enviar({ intent: 'remove', imageId: 'nao-uuid' })).headers.get('location')).toBe(`${volta}not_found`)
    expect((await enviar({ intent: 'explodir' })).headers.get('location')).toBe(`${volta}refused`)
    for (let i = 0; i < 6; i++) await addProductImage(dono, productId, await png(800 + i, 600))
    expect((await enviar({ file: await arquivo() })).headers.get('location')).toBe(`${volta}too_many_images`)
  })

  test('de outra origem é 403 e nada muda; módulo desligado volta com refused', async () => {
    expect((await enviar({ file: await arquivo() }, { host: 'painel.localhost:3000', origin: 'http://evil.example' })).status).toBe(403)
    expect(await imagens()).toHaveLength(0)
    await prisma.businessModules.update({ where: { businessId }, data: { store: false } })
    expect((await enviar({ file: await arquivo() })).headers.get('location')).toBe(`/loja/produtos/${productId}?imagem=refused`)
    expect(await imagens()).toHaveLength(0)
  })

  test('profissional recusado (refused) e produto inexistente volta com not_found', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await enviar({ file: await arquivo() })).headers.get('location')).toBe(`/loja/produtos/${productId}?imagem=refused`)
    guards.requireTenant.mockResolvedValue(dono)
    productId = '00000000-0000-4000-8000-000000000000'
    expect((await enviar({ file: await arquivo() })).headers.get('location')).toBe(`/loja/produtos/${productId}?imagem=not_found`)
  })
})
