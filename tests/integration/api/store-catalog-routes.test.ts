import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as listarEnderecos, POST as criarEndereco } from '@/app/api/v1/me/addresses/route'
import { DELETE as apagarEndereco, PATCH as editarEndereco } from '@/app/api/v1/me/addresses/[id]/route'
import { GET as categorias } from '@/app/api/v1/store/categories/route'
import { GET as opcoes } from '@/app/api/v1/store/options/route'
import { GET as consultarCep } from '@/app/api/v1/store/postal-codes/[cep]/route'
import { GET as umProduto } from '@/app/api/v1/store/products/[id]/route'
import { GET as produtos } from '@/app/api/v1/store/products/route'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { IntegrationError } from '@/server/integrations/errors'
import { createCategory } from '@/server/domain/store/categories'
import { archiveProduct } from '@/server/domain/store/products'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'
import { produto } from '../../setup/store'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena
let dono: Awaited<ReturnType<typeof makeCtx>>

beforeEach(async () => {
  await resetDb()
  setIntegrationsForTests(null)
  c = await montarCena()
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: true } })
  dono = await makeCtx(c.business)
})

const get = (h: Parameters<typeof callRoute>[0], path: string, o: { token?: string; params?: Record<string, string> } = {}) =>
  callRoute(h, apiRequest('GET', path, { key: c.key, ...(o.token ? { token: o.token } : {}) }), o.params ?? {})
const enviar = (h: Parameters<typeof callRoute>[0], method: string, path: string, body: unknown, o: { token?: string; params?: Record<string, string> } = {}) =>
  callRoute(h, apiRequest(method, path, { key: c.key, ...(o.token ? { token: o.token } : {}), ...(body === undefined ? {} : { body }) }), o.params ?? {})

const ENDERECO = { label: 'Casa', recipientName: 'Cliente Um', postalCode: '01310-100', street: 'Avenida Paulista', number: '1000', complement: null, district: 'Bela Vista', city: 'São Paulo', state: 'SP', isDefault: true }

describe('módulo desligado', () => {
  test('todas as rotas respondem 404 module_disabled, antes de validar o corpo e os parâmetros', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: false } })
    const t = c.tokenCliente
    const respostas = [
      await get(opcoes, '/v1/store/options'),
      await get(categorias, '/v1/store/categories'),
      await get(produtos, '/v1/store/products?limit=999'),
      await get(umProduto, '/v1/store/products/x', { params: { id: 'nao-uuid' } }),
      await get(consultarCep, '/v1/store/postal-codes/x', { token: t, params: { cep: 'lixo' } }),
      await get(listarEnderecos, '/v1/me/addresses', { token: t }),
      await enviar(criarEndereco, 'POST', '/v1/me/addresses', { lixo: 1 }, { token: t }),
      await enviar(editarEndereco, 'PATCH', '/v1/me/addresses/x', { lixo: 1 }, { token: t, params: { id: 'nao-uuid' } }),
      await enviar(apagarEndereco, 'DELETE', '/v1/me/addresses/x', undefined, { token: t, params: { id: 'nao-uuid' } }),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(404)
      expect(apiError(r.json).code).toBe('module_disabled')
    }
  })
})

describe('GET /v1/store/options e categories', () => {
  test('opções com a chave de app, sem login', async () => {
    await updateStoreSettings(dono, 0, { pickupEnabled: true, pickupInstructions: 'Na recepção', shippingEnabled: false, originPostalCode: null, defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 })
    const r = await get(opcoes, '/v1/store/options')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ pickup: { enabled: true, instructions: 'Na recepção' }, shipping: { enabled: false }, payment: { available: false } })
  })

  test('categorias: só as não arquivadas, com contagem; sem a chave é 401', async () => {
    const cat = await createCategory(dono, { name: 'Cabelo' })
    await produto(dono, { categoryId: cat.id })
    const r = await get(categorias, '/v1/store/categories')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ items: [{ id: cat.id, name: 'Cabelo', productCount: 1 }] })
    expect((await callRoute(categorias, apiRequest('GET', '/v1/store/categories'))).status).toBe(401)
  })
})

describe('GET /v1/store/products', () => {
  test('lista só os produtos à venda, sem estoque no corpo, com paginação por cursor', async () => {
    const a = await produto(dono, { name: 'Pomada', stock: 150 })
    await produto(dono, { name: 'Gel' })
    const arq = await produto(dono, { name: 'Antigo' })
    await archiveProduct(dono, arq.id)
    await produto(dono, { name: 'Inativo', active: false })
    const p1 = await get(produtos, '/v1/store/products?limit=1')
    const corpo = jsonObject(p1.json)
    expect(p1.status).toBe(200)
    expect(corpo.items).toHaveLength(1)
    expect(corpo.items).toMatchObject([{ id: a.id, name: 'Pomada', priceCents: 2500, finalPriceCents: 2500, available: true, maxQuantity: 99, images: [] }])
    expect(p1.text).not.toContain('"stock"')
    const p2 = jsonObject((await get(produtos, `/v1/store/products?limit=5&cursor=${encodeURIComponent(corpo.nextCursor as string)}`)).json)
    expect((p2.items as { name: string }[]).map((i) => i.name)).toEqual(['Gel'])
    expect(p2.nextCursor).toBeNull()
  })

  test('filtra por categoria e busca; parâmetro desconhecido ou limite fora é 422', async () => {
    const cat = await createCategory(dono, { name: 'Cabelo' })
    await produto(dono, { name: 'Pomada', categoryId: cat.id })
    await produto(dono, { name: 'Sabonete' })
    expect(((jsonObject((await get(produtos, `/v1/store/products?categoryId=${cat.id}`)).json).items) as unknown[]).length).toBe(1)
    expect(((jsonObject((await get(produtos, '/v1/store/products?search=sabon')).json).items) as unknown[]).length).toBe(1)
    expect((await get(produtos, '/v1/store/products?foo=1')).status).toBe(422)
    expect((await get(produtos, '/v1/store/products?limit=51')).status).toBe(422)
    expect((await get(produtos, '/v1/store/products?categoryId=lixo')).status).toBe(422)
  })

  test('um produto por id; inativo, arquivado e de outra conta dão 404; id que não é UUID é 422', async () => {
    const ok = await produto(dono, { name: 'Pomada' })
    const inativo = await produto(dono, { active: false })
    const r = await get(umProduto, `/v1/store/products/${ok.id}`, { params: { id: ok.id } })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ id: ok.id, name: 'Pomada', available: true })
    expect((await get(umProduto, `/v1/store/products/${inativo.id}`, { params: { id: inativo.id } })).status).toBe(404)
    const outra = await montarCena()
    await prisma.businessModules.update({ where: { businessId: outra.business.id }, data: { store: true } })
    const alheio = await produto(await makeCtx(outra.business), { name: 'Da outra' })
    const r2 = await get(umProduto, `/v1/store/products/${alheio.id}`, { params: { id: alheio.id } })
    expect(r2.status).toBe(404)
    expect(apiError(r2.json).code).toBe('not_found')
    expect((await get(umProduto, '/v1/store/products/x', { params: { id: 'nao-uuid' } })).status).toBe(422)
  })
})

describe('GET /v1/store/postal-codes/{cep}', () => {
  test('exige login de cliente', async () => {
    expect((await get(consultarCep, '/v1/store/postal-codes/01310100', { params: { cep: '01310100' } })).status).toBe(401)
  })

  test('devolve o endereço, null para CEP que não existe e unavailable com a ViaCEP fora do ar', async () => {
    const a = await get(consultarCep, '/v1/store/postal-codes/01310-100', { token: c.tokenCliente, params: { cep: '01310-100' } })
    expect(a.json).toEqual({ address: { postalCode: '01310100', street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }, unavailable: false })
    const b = await get(consultarCep, '/v1/store/postal-codes/00000000', { token: c.tokenCliente, params: { cep: '00000000' } })
    expect(b.json).toEqual({ address: null, unavailable: false })
    setIntegrationsForTests({ postalCodes: { lookup: async () => { throw new IntegrationError('timeout', 'x') } } })
    const d = await get(consultarCep, '/v1/store/postal-codes/01310100', { token: c.tokenCliente, params: { cep: '01310100' } })
    expect(d.status).toBe(200)
    expect(d.json).toEqual({ address: null, unavailable: true })
  })

  test('CEP mal formado é 422 e o limite é de 30 por minuto por pessoa', async () => {
    const ruim = await get(consultarCep, '/v1/store/postal-codes/1234-567', { token: c.tokenCliente, params: { cep: '1234-567' } })
    expect(ruim.status).toBe(422)
    expect(apiError(ruim.json).fields).toHaveProperty('postalCode')
    // A consulta recusada acima também conta no limite: restam 29.
    for (let i = 0; i < 29; i++) expect((await get(consultarCep, '/v1/store/postal-codes/01310100', { token: c.tokenCliente, params: { cep: '01310100' } })).status).toBe(200)
    const limite = await get(consultarCep, '/v1/store/postal-codes/01310100', { token: c.tokenCliente, params: { cep: '01310100' } })
    expect(limite.status).toBe(429)
    // Outra pessoa tem o próprio limite.
    expect((await get(consultarCep, '/v1/store/postal-codes/01310100', { token: c.tokenOutro, params: { cep: '01310100' } })).status).toBe(200)
  })
})

describe('/v1/me/addresses', () => {
  test('cria (201), lista, edita e apaga (204); só do próprio cliente', async () => {
    const criado = await enviar(criarEndereco, 'POST', '/v1/me/addresses', ENDERECO, { token: c.tokenCliente })
    expect(criado.status).toBe(201)
    const id = (jsonObject(criado.json).id as string)
    expect(jsonObject(criado.json)).toMatchObject({ postalCode: '01310100', state: 'SP', isDefault: true, complement: null })
    expect(jsonObject((await get(listarEnderecos, '/v1/me/addresses', { token: c.tokenCliente })).json).items).toHaveLength(1)
    expect(jsonObject((await get(listarEnderecos, '/v1/me/addresses', { token: c.tokenOutro })).json).items).toEqual([])
    const editado = await enviar(editarEndereco, 'PATCH', `/v1/me/addresses/${id}`, { number: '2000' }, { token: c.tokenCliente, params: { id } })
    expect(editado.status).toBe(200)
    expect(jsonObject(editado.json).number).toBe('2000')
    expect((await enviar(editarEndereco, 'PATCH', `/v1/me/addresses/${id}`, { number: '9' }, { token: c.tokenOutro, params: { id } })).status).toBe(404)
    expect((await enviar(apagarEndereco, 'DELETE', `/v1/me/addresses/${id}`, undefined, { token: c.tokenOutro, params: { id } })).status).toBe(404)
    const apagado = await enviar(apagarEndereco, 'DELETE', `/v1/me/addresses/${id}`, undefined, { token: c.tokenCliente, params: { id } })
    expect(apagado.status).toBe(204)
    expect(await prisma.address.count()).toBe(0)
  })

  test('exige login de cliente; UF inválida é 422 com o campo; corpo com campo desconhecido é 422', async () => {
    expect((await get(listarEnderecos, '/v1/me/addresses')).status).toBe(401)
    expect((await enviar(criarEndereco, 'POST', '/v1/me/addresses', ENDERECO)).status).toBe(401)
    const uf = await enviar(criarEndereco, 'POST', '/v1/me/addresses', { ...ENDERECO, state: 'XX' }, { token: c.tokenCliente })
    expect(uf.status).toBe(422)
    expect(Object.keys(apiError(uf.json).fields ?? {})).toEqual(['state'])
    expect((await enviar(criarEndereco, 'POST', '/v1/me/addresses', { ...ENDERECO, businessId: c.business.id }, { token: c.tokenCliente })).status).toBe(422)
    expect(await prisma.address.count()).toBe(0)
  })

  test('PATCH sem nenhum campo é 422', async () => {
    const criado = await enviar(criarEndereco, 'POST', '/v1/me/addresses', ENDERECO, { token: c.tokenCliente })
    const id = jsonObject(criado.json).id as string
    expect((await enviar(editarEndereco, 'PATCH', `/v1/me/addresses/${id}`, {}, { token: c.tokenCliente, params: { id } })).status).toBe(422)
  })
})
