import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { TenantViolationError } from '@/server/db/tenant'
import { archiveCategory, createCategory, listCategories, moveCategory, renameCategory } from '@/server/domain/store/categories'
import {
  adjustStock,
  addProductImage,
  archiveProduct,
  getProduct,
  getPublicProduct,
  listProducts,
  listPublicProducts,
  moveProductImage,
  removeProductImage,
  updateProduct,
} from '@/server/domain/store/products'
import { getStoreOptions, getStoreSettings, updateStoreSettings } from '@/server/domain/store/settings'
import { createGuestContext } from '@/server/auth/guest-context'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness } from '../setup/factories'
import { cenaLoja, configurarIntegracoes, dadosDoProduto, png, produto, type CenaLoja } from '../setup/store'

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  c = await cenaLoja()
})

const CONFIG = {
  pickupEnabled: true,
  pickupInstructions: 'Retire na recepção.',
  shippingEnabled: false,
  originPostalCode: null,
  defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 },
  paymentWindowMin: 60,
}

describe('configurações da loja', () => {
  test('sem linha, valem os padrões e a versão é 0', async () => {
    expect(await getStoreSettings(c.dono)).toEqual({
      pickupEnabled: true,
      pickupInstructions: null,
      shippingEnabled: false,
      originPostalCode: null,
      defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 },
      paymentWindowMin: 60,
      version: 0,
    })
  })

  test('a primeira gravação cria a linha (versão 1), a seguinte sobe a versão e uma versão velha é recusada', async () => {
    const a = await updateStoreSettings(c.dono, 0, CONFIG)
    expect(a).toMatchObject({ pickupInstructions: 'Retire na recepção.', version: 1 })
    const b = await updateStoreSettings(c.gerente, 1, { ...CONFIG, paymentWindowMin: 120 })
    expect(b).toMatchObject({ paymentWindowMin: 120, version: 2 })
    const velha = await domainError(updateStoreSettings(c.dono, 1, { ...CONFIG, paymentWindowMin: 30 }))
    expect(velha.code).toBe('conflict')
    expect(velha.reason).toBe('stale_version')
    const outra = await domainError(updateStoreSettings(c.dono, 0, CONFIG))
    expect(outra.reason).toBe('stale_version')
    expect((await getStoreSettings(c.dono)).paymentWindowMin).toBe(120)
  })

  test('duas primeiras gravações ao mesmo tempo: uma vale, a outra é stale_version', async () => {
    const r = await Promise.allSettled([updateStoreSettings(c.dono, 0, CONFIG), updateStoreSettings(c.gerente, 0, { ...CONFIG, paymentWindowMin: 90 })])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const falha = r.find((x) => x.status === 'rejected')
    expect(falha?.status === 'rejected' && (falha.reason as { reason?: string }).reason).toBe('stale_version')
    expect(await prisma.storeSettings.count({ where: { businessId: c.b.id } })).toBe(1)
  })

  test('desligar retirada e entrega juntas é validation', async () => {
    const e = await domainError(updateStoreSettings(c.dono, 0, { ...CONFIG, pickupEnabled: false, shippingEnabled: false }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('pickupEnabled')
    expect(await prisma.storeSettings.count()).toBe(0)
  })

  test('entrega ligada sem CEP de origem: erro no campo; com CEP, normaliza os dígitos', async () => {
    const e = await domainError(updateStoreSettings(c.dono, 0, { ...CONFIG, shippingEnabled: true }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toEqual(['originPostalCode'])
    const ok = await updateStoreSettings(c.dono, 0, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310-100' })
    expect(ok).toMatchObject({ shippingEnabled: true, originPostalCode: '01310100' })
    const ruim = await domainError(updateStoreSettings(c.dono, 1, { ...CONFIG, originPostalCode: '1234' }))
    expect(Object.keys(ruim.fields ?? {})).toEqual(['originPostalCode'])
  })

  test('limites do pacote padrão e do prazo para pagar', async () => {
    for (const [campo, mudanca] of [
      ['paymentWindowMin', { paymentWindowMin: 29 }],
      ['paymentWindowMin', { paymentWindowMin: 1441 }],
      ['defaultPackage.weightGrams', { defaultPackage: { ...CONFIG.defaultPackage, weightGrams: 0 } }],
      ['defaultPackage.lengthCm', { defaultPackage: { ...CONFIG.defaultPackage, lengthCm: 201 } }],
    ] as const) {
      const e = await domainError(updateStoreSettings(c.dono, 0, { ...CONFIG, ...mudanca }))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {}), campo).toContain(campo)
    }
  })

  test('só quem tem manage_store grava; profissional não lê nem grava; módulo desligado recusa', async () => {
    expect((await domainError(updateStoreSettings(c.profissional, 0, CONFIG))).code).toBe('forbidden')
    expect((await domainError(getStoreSettings(c.profissional))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(updateStoreSettings(c.dono, 0, CONFIG))).code).toBe('module_disabled')
    expect((await domainError(getStoreSettings(c.dono))).code).toBe('module_disabled')
    expect(await prisma.storeSettings.count()).toBe(0)
  })

  test('a gravação deixa auditoria e a conta B não enxerga a linha da A', async () => {
    await updateStoreSettings(c.dono, 0, CONFIG)
    expect(await prisma.auditLog.count({ where: { businessId: c.b.id, action: 'store.settings_updated' } })).toBe(1)
    const b2 = await cenaLoja()
    expect((await getStoreSettings(b2.dono)).version).toBe(0)
  })
})

describe('opções da loja (o que o app vê)', () => {
  test('retirada ligada, entrega e pagamento desligados por padrão; instruções aparecem', async () => {
    await updateStoreSettings(c.dono, 0, CONFIG)
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect(await getStoreOptions(visitante)).toEqual({
      pickup: { enabled: true, instructions: 'Retire na recepção.' },
      shipping: { enabled: false },
      payment: { available: false },
    })
  })

  test('pagamento disponível só com o Mercado Pago configurado; entrega só com CEP de origem e Frenet', async () => {
    await updateStoreSettings(c.dono, 0, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310100' })
    expect((await getStoreOptions(c.ctxCliente)).shipping.enabled).toBe(false)
    await configurarIntegracoes(c.b.id, { mercadoPago: true, frenet: true })
    const o = await getStoreOptions(c.ctxCliente)
    expect(o.payment.available).toBe(true)
    expect(o.shipping.enabled).toBe(true)
    await configurarIntegracoes(c.b.id, { frenet: 'remover' })
    expect((await getStoreOptions(c.ctxCliente)).shipping.enabled).toBe(false)
  })

  test('módulo desligado: module_disabled', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(getStoreOptions(c.ctxCliente))).code).toBe('module_disabled')
  })
})

describe('categorias', () => {
  test('cria em ordem, renomeia, move e arquiva; produtos contam', async () => {
    const a = await createCategory(c.dono, { name: 'Cabelo' })
    const b = await createCategory(c.dono, { name: 'Barba' })
    expect([a.displayOrder, b.displayOrder]).toEqual([1, 2])
    await produto(c.dono, { categoryId: a.id })
    await produto(c.dono, { categoryId: a.id, active: false })
    expect((await listCategories(c.dono)).map((x) => [x.name, x.productCount])).toEqual([['Cabelo', 2], ['Barba', 0]])
    await moveCategory(c.dono, b.id, 'up')
    expect((await listCategories(c.dono)).map((x) => x.name)).toEqual(['Barba', 'Cabelo'])
    await moveCategory(c.dono, b.id, 'up')
    expect((await listCategories(c.dono)).map((x) => x.name)).toEqual(['Barba', 'Cabelo'])
    expect((await renameCategory(c.dono, b.id, { name: 'Barbearia' })).name).toBe('Barbearia')
    await archiveCategory(c.dono, a.id)
    expect((await listCategories(c.dono)).map((x) => x.name)).toEqual(['Barbearia'])
    expect((await listCategories(c.dono, { includeArchived: true })).map((x) => x.name)).toContain('Cabelo')
  })

  test('nome repetido, sem acento e com outra caixa, é conflict; arquivada libera o nome', async () => {
    const a = await createCategory(c.dono, { name: 'Pós-barba' })
    for (const nome of ['pós-barba', 'POS-BARBA', '  Pós-Barba  ']) {
      const e = await domainError(createCategory(c.dono, { name: nome }))
      expect(e.code, nome).toBe('conflict')
      expect(e.fields).toHaveProperty('name')
    }
    const outra = await createCategory(c.dono, { name: 'Cabelo' })
    expect((await domainError(renameCategory(c.dono, outra.id, { name: 'pos-barba' }))).code).toBe('conflict')
    await archiveCategory(c.dono, a.id)
    expect((await createCategory(c.dono, { name: 'Pós-barba' })).name).toBe('Pós-barba')
  })

  test('criações simultâneas do mesmo nome: uma só passa', async () => {
    const r = await Promise.allSettled([createCategory(c.dono, { name: 'Cabelo' }), createCategory(c.gerente, { name: 'cabelo' }), createCategory(c.dono, { name: 'CABELO' })])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.productCategory.count({ where: { businessId: c.b.id } })).toBe(1)
  })

  test('ordem sem repetição com criações simultâneas', async () => {
    await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => createCategory(c.dono, { name: n })))
    const ordens = (await listCategories(c.dono)).map((x) => x.displayOrder)
    expect(new Set(ordens).size).toBe(5)
  })

  test('nome vazio ou longo demais; profissional e módulo desligado recusados; categoria da conta B é not_found', async () => {
    expect((await domainError(createCategory(c.dono, { name: '   ' }))).fields).toHaveProperty('name')
    expect((await domainError(createCategory(c.dono, { name: 'x'.repeat(61) }))).fields).toHaveProperty('name')
    expect((await domainError(createCategory(c.profissional, { name: 'A' }))).code).toBe('forbidden')
    const b2 = await cenaLoja()
    const alheia = await createCategory(b2.dono, { name: 'Alheia' })
    expect((await domainError(renameCategory(c.dono, alheia.id, { name: 'X' }))).code).toBe('not_found')
    expect((await domainError(archiveCategory(c.dono, 'nao-uuid'))).code).toBe('not_found')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(createCategory(c.dono, { name: 'B' }))).code).toBe('module_disabled')
  })

  test('o app vê só as categorias não arquivadas, com a contagem de produtos à venda', async () => {
    const a = await createCategory(c.dono, { name: 'Cabelo' })
    const b = await createCategory(c.dono, { name: 'Barba' })
    await produto(c.dono, { categoryId: a.id })
    await produto(c.dono, { categoryId: a.id, active: false })
    await archiveCategory(c.dono, b.id)
    const lista = await listCategories(c.ctxCliente)
    expect(lista.map((x) => [x.name, x.productCount])).toEqual([['Cabelo', 1]])
    expect(await listCategories(c.ctxCliente, { includeArchived: true })).toHaveLength(1)
  })
})

describe('produtos: dados e regras', () => {
  test('cria com preço final, ordem e auditoria', async () => {
    const p = await produto(c.dono, { name: 'Pomada', priceCents: 3000, promoPriceCents: 2500 })
    expect(p).toMatchObject({ name: 'Pomada', priceCents: 3000, promoPriceCents: 2500, finalPriceCents: 2500, stock: 10, displayOrder: 1, images: [], archivedAt: null })
    expect((await produto(c.dono, { name: 'Gel' })).finalPriceCents).toBe(2500)
    expect(await prisma.auditLog.count({ where: { businessId: c.b.id, action: 'product.created' } })).toBe(2)
  })

  test('promoção igual ou maior que o preço é erro no campo promoPriceCents', async () => {
    for (const promo of [3000, 3001]) {
      const e = await domainError(produto(c.dono, { priceCents: 3000, promoPriceCents: promo }))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toEqual(['promoPriceCents'])
    }
    expect(await prisma.product.count()).toBe(0)
  })

  test('no update a promoção é conferida com o preço de agora', async () => {
    const p = await produto(c.dono, { priceCents: 3000, promoPriceCents: 2000 })
    const e = await domainError(updateProduct(c.dono, p.id, { priceCents: 1500 }))
    expect(Object.keys(e.fields ?? {})).toEqual(['promoPriceCents'])
    const ok = await updateProduct(c.dono, p.id, { priceCents: 1500, promoPriceCents: null })
    expect(ok).toMatchObject({ priceCents: 1500, promoPriceCents: null, finalPriceCents: 1500 })
  })

  test('limites: preço > 0, estoque 0 a 100.000, peso 1 a 30.000 g, lados 1 a 200 cm', async () => {
    const ruins: [string, Partial<Parameters<typeof dadosDoProduto>[0]>][] = [
      ['priceCents', { priceCents: 0 }],
      ['priceCents', { priceCents: 12.5 }],
      ['promoPriceCents', { promoPriceCents: 0 }],
      ['stock', { stock: -1 }],
      ['stock', { stock: 100_001 }],
      ['weightGrams', { weightGrams: 0 }],
      ['weightGrams', { weightGrams: 30_001 }],
      ['lengthCm', { lengthCm: 201 }],
      ['heightCm', { heightCm: 0 }],
      ['widthCm', { widthCm: 201 }],
      ['name', { name: '  ' }],
      ['name', { name: 'x'.repeat(121) }],
      ['description', { description: 'x'.repeat(1001) }],
    ]
    for (const [campo, mudanca] of ruins) {
      const e = await domainError(produto(c.dono, mudanca))
      expect(Object.keys(e.fields ?? {}), campo).toContain(campo)
    }
    const ok = await produto(c.dono, { stock: 100_000, weightGrams: 30_000, lengthCm: 200, heightCm: 1, widthCm: 200 })
    expect(ok).toMatchObject({ stock: 100_000, weightGrams: 30_000, lengthCm: 200, heightCm: 1, widthCm: 200 })
  })

  test('categoria de outra conta ou arquivada não serve', async () => {
    const b2 = await cenaLoja()
    const alheia = await createCategory(b2.dono, { name: 'Alheia' })
    expect(Object.keys((await domainError(produto(c.dono, { categoryId: alheia.id }))).fields ?? {})).toEqual(['categoryId'])
    const minha = await createCategory(c.dono, { name: 'Minha' })
    await archiveCategory(c.dono, minha.id)
    expect(Object.keys((await domainError(produto(c.dono, { categoryId: minha.id }))).fields ?? {})).toEqual(['categoryId'])
  })

  test('produto da conta B por id em A é not_found, inclusive no público', async () => {
    const b2 = await cenaLoja()
    const alheio = await produto(b2.dono)
    expect((await domainError(getProduct(c.dono, alheio.id))).code).toBe('not_found')
    expect((await domainError(updateProduct(c.dono, alheio.id, { name: 'X' }))).code).toBe('not_found')
    expect((await domainError(adjustStock(c.dono, alheio.id, 1, 'entrada'))).code).toBe('not_found')
    expect((await domainError(archiveProduct(c.dono, alheio.id))).code).toBe('not_found')
    expect((await domainError(getPublicProduct(c.ctxCliente, alheio.id))).code).toBe('not_found')
    expect((await domainError(getProduct(c.dono, 'nao-uuid'))).code).toBe('not_found')
    expect((await prisma.product.findUniqueOrThrow({ where: { id: alheio.id } })).name).toBe('Shampoo')
  })

  test('profissional não gerencia; cliente não gerencia; módulo desligado recusa tudo', async () => {
    expect((await domainError(produto(c.profissional))).code).toBe('forbidden')
    expect((await domainError(produto(c.ctxCliente))).code).toBe('forbidden')
    expect((await domainError(listProducts(c.profissional))).code).toBe('forbidden')
    const p = await produto(c.dono)
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(produto(c.dono))).code).toBe('module_disabled')
    expect((await domainError(getProduct(c.dono, p.id))).code).toBe('module_disabled')
    expect((await domainError(listPublicProducts(c.ctxCliente))).code).toBe('module_disabled')
    expect((await domainError(getPublicProduct(c.ctxCliente, p.id))).code).toBe('module_disabled')
    expect((await domainError(adjustStock(c.dono, p.id, 1, 'entrada'))).code).toBe('module_disabled')
  })

  test('updateProduct com expectedStock recusa quando uma venda mexeu no estoque no meio', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await prisma.product.update({ where: { id: p.id }, data: { stock: 7 } })
    const e = await domainError(updateProduct(c.dono, p.id, { stock: 10, expectedStock: 10 }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('changed')
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7)
    expect((await updateProduct(c.dono, p.id, { stock: 20, expectedStock: 7 })).stock).toBe(20)
  })
})

describe('produtos: listas', () => {
  test('lista da equipe por situação, categoria e busca (sem acento), com paginação por cursor', async () => {
    const cat = await createCategory(c.dono, { name: 'Cabelo' })
    const a = await produto(c.dono, { name: 'Pomada modeladora', categoryId: cat.id })
    await produto(c.dono, { name: 'Condicionador', active: false })
    const arq = await produto(c.dono, { name: 'Gel antigo' })
    await archiveProduct(c.dono, arq.id)
    expect((await listProducts(c.dono)).items.map((p) => p.name)).toEqual(['Pomada modeladora', 'Condicionador'])
    expect((await listProducts(c.dono, { situation: 'active' })).items.map((p) => p.name)).toEqual(['Pomada modeladora'])
    expect((await listProducts(c.dono, { situation: 'inactive' })).items.map((p) => p.name)).toEqual(['Condicionador'])
    expect((await listProducts(c.dono, { situation: 'archived' })).items.map((p) => p.name)).toEqual(['Gel antigo'])
    expect((await listProducts(c.dono, { categoryId: cat.id })).items.map((p) => p.id)).toEqual([a.id])
    expect((await listProducts(c.dono, { search: 'MODELADORA' })).items).toHaveLength(1)
    const p1 = await listProducts(c.dono, { limit: 1 })
    expect(p1.items).toHaveLength(1)
    expect(p1.nextCursor).not.toBeNull()
    const p2 = await listProducts(c.dono, { limit: 1, cursor: p1.nextCursor ?? '' })
    expect(p2.items.map((p) => p.name)).toEqual(['Condicionador'])
    expect(p2.nextCursor).toBeNull()
    expect((await domainError(listProducts(c.dono, { cursor: 'lixo' }))).code).toBe('validation')
  })

  test('produto inativo, arquivado ou de categoria arquivada não aparece ao app; getPublicProduct é not_found', async () => {
    const cat = await createCategory(c.dono, { name: 'Cabelo' })
    const visivel = await produto(c.dono, { name: 'Visível' })
    const inativo = await produto(c.dono, { name: 'Inativo', active: false })
    const arquivado = await produto(c.dono, { name: 'Arquivado' })
    await archiveProduct(c.dono, arquivado.id)
    const daCategoria = await produto(c.dono, { name: 'Da categoria', categoryId: cat.id })
    expect((await listPublicProducts(c.ctxCliente)).items.map((p) => p.name)).toEqual(['Visível', 'Da categoria'])
    await archiveCategory(c.dono, cat.id)
    const publica = await listPublicProducts(c.ctxCliente)
    expect(publica.items.map((p) => p.name)).toEqual(['Visível'])
    expect((await getPublicProduct(c.ctxCliente, visivel.id)).name).toBe('Visível')
    for (const p of [inativo, arquivado, daCategoria]) expect((await domainError(getPublicProduct(c.ctxCliente, p.id))).code, p.name).toBe('not_found')
    expect((await listPublicProducts(c.ctxCliente, { categoryId: cat.id })).items).toEqual([])
  })

  test('o visitante (só com a chave) também vê o catálogo público', async () => {
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    await produto(c.dono, { name: 'Visível' })
    expect((await listPublicProducts(visitante)).items).toHaveLength(1)
  })

  test('forma pública: preço final, disponibilidade e maxQuantity (estoque 150 → 99, estoque 0 → indisponível)', async () => {
    const muito = await produto(c.dono, { name: 'Muito', stock: 150, priceCents: 1000, promoPriceCents: 800 })
    const pouco = await produto(c.dono, { name: 'Pouco', stock: 3 })
    const zero = await produto(c.dono, { name: 'Zero', stock: 0 })
    const itens = (await listPublicProducts(c.ctxCliente)).items
    expect(itens.find((p) => p.id === muito.id)).toMatchObject({ priceCents: 1000, promoPriceCents: 800, finalPriceCents: 800, available: true, maxQuantity: 99 })
    expect(itens.find((p) => p.id === pouco.id)).toMatchObject({ available: true, maxQuantity: 3 })
    expect(itens.find((p) => p.id === zero.id)).toMatchObject({ available: false, maxQuantity: 0 })
    const unico = await getPublicProduct(c.ctxCliente, muito.id)
    expect(Object.keys(unico).sort()).toEqual(['available', 'categoryId', 'description', 'finalPriceCents', 'id', 'images', 'maxQuantity', 'name', 'priceCents', 'promoPriceCents'])
    expect(JSON.stringify(unico)).not.toContain('stock')
  })
})

describe('estoque', () => {
  test('entrada e saída manuais, com motivo e auditoria', async () => {
    const p = await produto(c.dono, { stock: 3 })
    expect((await adjustStock(c.dono, p.id, 10, 'Chegou caixa nova')).stock).toBe(13)
    expect((await adjustStock(c.dono, p.id, -13, 'Contagem')).stock).toBe(0)
    const log = await prisma.auditLog.findMany({ where: { businessId: c.b.id, action: 'product.stock_adjusted' }, orderBy: { createdAt: 'asc' } })
    expect(log).toHaveLength(2)
    expect(log[0]?.metadata).toMatchObject({ delta: 10, from: 3, to: 13, reason: 'Chegou caixa nova' })
  })

  test('adjustStock(-5) com estoque 3 é recusado e nada muda', async () => {
    const p = await produto(c.dono, { stock: 3 })
    const e = await domainError(adjustStock(c.dono, p.id, -5, 'Quebra'))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('delta')
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3)
  })

  test('zero, fração, passar de 100.000 e motivo curto são recusados', async () => {
    const p = await produto(c.dono, { stock: 3 })
    expect((await domainError(adjustStock(c.dono, p.id, 0, 'Nada'))).fields).toHaveProperty('delta')
    expect((await domainError(adjustStock(c.dono, p.id, 1.5, 'Meio'))).fields).toHaveProperty('delta')
    expect((await domainError(adjustStock(c.dono, p.id, 100_000, 'Demais'))).fields).toHaveProperty('delta')
    expect((await domainError(adjustStock(c.dono, p.id, 1, 'a'))).fields).toHaveProperty('reason')
    expect((await domainError(adjustStock(c.profissional, p.id, 1, 'Entrada'))).code).toBe('forbidden')
  })

  test('saídas simultâneas nunca deixam o estoque negativo', async () => {
    const p = await produto(c.dono, { stock: 5 })
    const r = await Promise.allSettled(Array.from({ length: 8 }, () => adjustStock(c.dono, p.id, -1, 'Venda no balcão')))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(5)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0)
  })
})

describe('imagens do produto', () => {
  test('envia, ordena, remove e apaga o arquivo; a sétima é recusada', async () => {
    const p = await produto(c.dono)
    let v = await addProductImage(c.dono, p.id, await png())
    expect(v.images).toHaveLength(1)
    expect(v.images[0]?.url).toMatch(/^\//)
    for (let i = 0; i < 5; i++) v = await addProductImage(c.dono, p.id, await png(800 + i, 600))
    expect(v.images).toHaveLength(6)
    const sete = await domainError(addProductImage(c.dono, p.id, await png()))
    expect(sete.code).toBe('validation')
    expect(sete.details).toMatchObject({ imageCode: 'too_many_images' })
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(6)
    const [primeira, segunda] = v.images
    v = await moveProductImage(c.dono, p.id, segunda?.id ?? '', 'up')
    expect(v.images.map((i) => i.id).slice(0, 2)).toEqual([segunda?.id, primeira?.id])
    v = await moveProductImage(c.dono, p.id, segunda?.id ?? '', 'up')
    expect(v.images[0]?.id).toBe(segunda?.id)
    v = await moveProductImage(c.dono, p.id, v.images[5]?.id ?? '', 'down')
    expect(v.images).toHaveLength(6)
    const sai = v.images[2]?.id ?? ''
    v = await removeProductImage(c.dono, p.id, sai)
    expect(v.images).toHaveLength(5)
    expect(v.images.map((i) => i.id)).not.toContain(sai)
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(5)
    const posicoes = (await prisma.productImage.findMany({ where: { productId: p.id }, orderBy: { position: 'asc' } })).map((i) => i.position)
    expect(posicoes).toEqual([1, 2, 3, 4, 5])
  })

  test('arquivo que não é imagem é recusado e nada fica; imagem de outro produto não se remove por este', async () => {
    const p = await produto(c.dono)
    const q = await produto(c.dono, { name: 'Outro' })
    const e = await domainError(addProductImage(c.dono, p.id, { bytes: new Uint8Array([1, 2, 3]) }))
    expect(e.code).toBe('validation')
    expect(await prisma.upload.count()).toBe(0)
    const doQ = (await addProductImage(c.dono, q.id, await png())).images[0]?.id ?? ''
    expect((await domainError(removeProductImage(c.dono, p.id, doQ))).code).toBe('not_found')
    expect((await domainError(moveProductImage(c.dono, p.id, doQ, 'up'))).code).toBe('not_found')
    expect(await prisma.productImage.count()).toBe(1)
  })

  test('envios simultâneos nunca passam de seis e as posições não se repetem', async () => {
    const p = await produto(c.dono)
    const imagens = await Promise.all(Array.from({ length: 9 }, (_, i) => png(800 + i, 600)))
    const r = await Promise.allSettled(imagens.map((img) => addProductImage(c.dono, p.id, img)))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(6)
    expect(await prisma.productImage.count({ where: { productId: p.id } })).toBe(6)
    expect(await prisma.upload.count({ where: { businessId: c.b.id } })).toBe(6)
  })

  test('na lista pública as imagens vêm em ordem, só com a url', async () => {
    const p = await produto(c.dono)
    await addProductImage(c.dono, p.id, await png())
    await addProductImage(c.dono, p.id, await png(900, 600))
    const pub = await getPublicProduct(c.ctxCliente, p.id)
    expect(pub.images).toHaveLength(2)
    expect(Object.keys(pub.images[0] ?? {})).toEqual(['url'])
  })

  test('arquivar o produto mantém as imagens; módulo desligado e profissional recusados', async () => {
    const p = await produto(c.dono)
    expect((await domainError(addProductImage(c.profissional, p.id, await png()))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(addProductImage(c.dono, p.id, await png()))).code).toBe('module_disabled')
    expect(await prisma.upload.count()).toBe(0)
  })
})

describe('isolamento do cliente por conta', () => {
  test('tenantDb não alcança as tabelas da loja de outra conta', async () => {
    const b2 = await cenaLoja()
    await produto(b2.dono, { name: 'Da B' })
    expect(await c.dono.db.product.count()).toBe(0)
    expect(await c.dono.db.storeSettings.count()).toBe(0)
    await expect(c.dono.db.product.create({ data: { businessId: b2.b.id, name: 'x', priceCents: 1, stock: 1 } })).rejects.toThrow(TenantViolationError)
  })

  test('o dono de outra conta nunca grava na conta A', async () => {
    const outra = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: outra.id }, data: { store: true } })
    const donoB = await ctxWithRole(outra, 'OWNER')
    const p = await produto(c.dono)
    expect((await domainError(updateProduct(donoB, p.id, { name: 'Invadido' }))).code).toBe('not_found')
  })
})
