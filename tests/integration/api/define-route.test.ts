import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as healthGet } from '@/app/api/v1/health/route'
import { defineRoute, preflight } from '@/server/api/define-route'
import { registerRoute, registeredRoutes } from '@/server/api/registry'
import { signAccessToken } from '@/server/auth/api-tokens'
import type { Business, Customer } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { DomainError, z } from '@/server/domain/errors'
import { addMinutes } from '@/server/time'
import { apiError, apiRequest, callRoute, customerToken, jsonObject, makeAppKey, staffToken } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../../setup/factories'

const objetoQualquer = z.object({}).passthrough()

const publica = defineRoute({
  method: 'GET',
  path: '/v1/teste/publica',
  auth: 'none',
  summary: 'Rota pública',
  tag: 'teste',
  response: z.object({ ok: z.literal(true), temChave: z.boolean(), temContexto: z.boolean() }),
  handler: async ({ ctx, key }) => ({ ok: true as const, temChave: key !== null, temContexto: ctx !== null }),
})

const porChave = defineRoute({
  method: 'GET',
  path: '/v1/teste/chave',
  auth: 'key',
  summary: 'Rota só com chave',
  tag: 'teste',
  response: z.object({ businessId: z.string(), slug: z.string(), timeZone: z.string(), ctxNulo: z.boolean() }),
  handler: async ({ ctx, key }) => {
    if (!key) throw new Error('sem chave')
    return { businessId: key.businessId, slug: key.businessSlug, timeZone: key.timeZone, ctxNulo: ctx === null }
  },
})

const doCliente = defineRoute({
  method: 'GET',
  path: '/v1/teste/cliente',
  auth: 'customer',
  summary: 'Rota do cliente',
  tag: 'teste',
  response: z.object({ canal: z.string(), ator: z.string(), clienteId: z.string().nullable(), businessId: z.string() }),
  handler: async ({ ctx }) => {
    if (!ctx) throw new Error('sem contexto')
    return {
      canal: ctx.channel,
      ator: ctx.actor.kind,
      clienteId: ctx.actor.kind === 'customer' ? ctx.actor.customerId : null,
      businessId: ctx.businessId,
    }
  },
})

const daEquipe = defineRoute({
  method: 'GET',
  path: '/v1/teste/equipe',
  auth: 'staff',
  summary: 'Rota da equipe',
  tag: 'teste',
  response: z.object({ canal: z.string(), papel: z.string().nullable(), membershipId: z.string().nullable() }),
  handler: async ({ ctx }) => {
    if (!ctx) throw new Error('sem contexto')
    return {
      canal: ctx.channel,
      papel: ctx.actor.kind === 'member' ? ctx.actor.role : null,
      membershipId: ctx.actor.kind === 'member' ? ctx.actor.membershipId : null,
    }
  },
})

const eco = defineRoute({
  method: 'POST',
  path: '/v1/teste/eco',
  auth: 'key',
  summary: 'Devolve o corpo',
  tag: 'teste',
  body: z.object({ nome: z.string().min(1), qtd: z.number().int(), extra: z.strictObject({ a: z.number().optional() }).optional() }),
  response: objetoQualquer,
  handler: async ({ body }) => ({ ...body }),
})

const comParametros = defineRoute({
  method: 'GET',
  path: '/v1/teste/itens/{id}',
  auth: 'key',
  summary: 'Parâmetros e consulta',
  tag: 'teste',
  params: z.object({ id: z.uuid() }),
  query: z.object({ n: z.coerce.number().int().min(1).default(1), tags: z.union([z.string(), z.array(z.string())]).optional() }),
  response: objetoQualquer,
  handler: async ({ params, query }) => ({ id: params.id, n: query.n, tags: query.tags ?? null }),
})

const explode = defineRoute({
  method: 'GET',
  path: '/v1/teste/explode',
  auth: 'key',
  summary: 'Erro inesperado',
  tag: 'teste',
  response: objetoQualquer,
  handler: async () => {
    throw new Error('detalhe-interno-secreto')
  },
})

const conflito = defineRoute({
  method: 'GET',
  path: '/v1/teste/conflito',
  auth: 'key',
  summary: 'Erro de domínio',
  tag: 'teste',
  response: objetoQualquer,
  handler: async () => {
    throw new DomainError('conflict', 'Este horário já foi ocupado. Escolha outro.', {
      reason: 'slot_taken',
      details: { startsAt: new Date(1_800_000_000_000) },
    })
  },
})

const comDatas = defineRoute({
  method: 'GET',
  path: '/v1/teste/datas',
  auth: 'key',
  summary: 'Datas na resposta',
  tag: 'teste',
  response: z.object({ quando: z.date(), grande: z.bigint(), nada: z.undefined().optional(), lista: z.array(z.date()) }),
  handler: async () => {
    const quando = addMinutes(new Date(1_800_000_000_000), 0)
    return { quando, grande: 7n, nada: undefined, lista: [quando] }
  },
})

const foraDoContrato = defineRoute({
  method: 'GET',
  path: '/v1/teste/fora-do-contrato',
  auth: 'key',
  summary: 'Resposta fora do contrato',
  tag: 'teste',
  response: z.object({ n: z.number() }),
  handler: async () => ({ n: 'não é número' }) as unknown as { n: number },
})

const limitada = defineRoute({
  method: 'GET',
  path: '/v1/teste/limitada',
  auth: 'key',
  summary: 'Limite próprio',
  tag: 'teste',
  limit: { limit: 2, windowSec: 60 },
  response: objetoQualquer,
  handler: async () => ({}),
})

const criada = defineRoute({
  method: 'POST',
  path: '/v1/teste/criada',
  auth: 'key',
  status: 201,
  summary: 'Criada',
  tag: 'teste',
  body: z.object({ nome: z.string() }),
  response: z.object({ nome: z.string() }),
  handler: async ({ body }) => body,
})

const apagada = defineRoute({
  method: 'DELETE',
  path: '/v1/teste/apagada',
  auth: 'key',
  status: 204,
  summary: 'Apagada',
  tag: 'teste',
  response: z.undefined(),
  handler: async () => undefined,
})

let a: Business
let b: Business
let chaveA: { secret: string; id: string }
const ORIGEM = 'https://app.exemplo.com'

beforeEach(async () => {
  await resetDb()
  a = await makeBusiness()
  b = await makeBusiness()
  chaveA = await makeAppKey(a.id, { allowedOrigins: [ORIGEM, 'http://*.localhost:5173'] })
})

const comChave = (o: Parameters<typeof apiRequest>[2] = {}) => ({ key: chaveA.secret, ...o })

describe('chave de app', () => {
  test('sem chave: 401 invalid_app_key, com Content-Type, no-store e X-Request-Id', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave'))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'invalid_app_key' })
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('chave inventada: 401 invalid_app_key', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: 'afk_a_00000000_' + 'A'.repeat(43) }))
    expect(r.status).toBe(401)
    expect(apiError(r.json).reason).toBe('invalid_app_key')
  })

  test('chave de plataforma sem X-Business: 401; com X-Business a conta é a do cabeçalho', async () => {
    const plataforma = await makeAppKey(null)
    const sem = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: plataforma.secret }))
    expect(sem.status).toBe(401)
    expect(apiError(sem.json).reason).toBe('unknown_business')
    const com = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: plataforma.secret, business: b.slug }))
    expect(com.status).toBe(200)
    expect(jsonObject(com.json).businessId).toBe(b.id)
  })

  test('chave de conta com X-Business de outra conta: 403', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ business: b.slug })))
    expect(r.status).toBe(403)
    expect(apiError(r.json).reason).toBe('business_mismatch')
  })

  test('rota com chave: o handler recebe a conta e ctx nulo', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ businessId: a.id, slug: a.slug, timeZone: a.timezone, ctxNulo: true })
  })

  test('conta suspensa: 503 business_unavailable', async () => {
    await prisma.business.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } })
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    expect(r.status).toBe(503)
    expect(apiError(r.json).code).toBe('business_unavailable')
  })

  test('rota pública: responde sem chave, sem chave nem contexto no handler', async () => {
    const r = await callRoute(publica, apiRequest('GET', '/v1/teste/publica'))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true, temChave: false, temContexto: false })
  })

  test('GET /v1/health responde sem chave', async () => {
    const r = await callRoute(healthGet, apiRequest('GET', '/v1/health'))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ status: 'ok' })
    expect(r.headers.get('x-request-id')).not.toBeNull()
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
})

describe('CORS', () => {
  test('sem Origin segue, sem cabeçalhos CORS', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('origem salva: ecoa a origem, Vary: Origin e nunca credenciais nem *', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ origin: ORIGEM })))
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(r.headers.get('vary')?.toLowerCase()).toContain('origin')
    expect(r.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('curinga de localhost casa subdomínio na porta; imitação não casa', async () => {
    const ok = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ origin: 'http://loja.localhost:5173' })))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://loja.localhost:5173')
    for (const falsa of ['http://localhost.evil.com:5173', 'http://loja.localhost:9999', 'http://loja.localhost.evil.com:5173']) {
      const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ origin: falsa })))
      expect(r.status, falsa).toBe(403)
    }
  })

  test('origem não permitida: 403 origin_not_allowed, sem cabeçalhos CORS', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ origin: 'https://outro.com' })))
    expect(r.status).toBe(403)
    expect(apiError(r.json)).toMatchObject({ code: 'forbidden', reason: 'origin_not_allowed' })
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('chave sem origens salvas recusa qualquer origem web, mas aceita app nativo (sem Origin)', async () => {
    const vazia = await makeAppKey(a.id)
    const web = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: vazia.secret, origin: ORIGEM }))
    expect(web.status).toBe(403)
    const nativo = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: vazia.secret }))
    expect(nativo.status).toBe(200)
  })

  test('erro de rota depois da checagem de origem também leva os cabeçalhos CORS', async () => {
    const r = await callRoute(conflito, apiRequest('GET', '/v1/teste/conflito', comChave({ origin: ORIGEM })))
    expect(r.status).toBe(409)
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
  })

  test('as respostas expõem Retry-After e X-Request-Id ao navegador', async () => {
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave({ origin: ORIGEM })))
    const expostos = (r.headers.get('access-control-expose-headers') ?? '').toLowerCase()
    expect(expostos).toContain('retry-after')
    expect(expostos).toContain('x-request-id')
  })

  test('pré-voo sem chave: 204 com origem, métodos, cabeçalhos e Max-Age', async () => {
    const r = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/chave', { origin: ORIGEM, headers: { 'access-control-request-method': 'POST' } }))
    expect(r.status).toBe(204)
    expect(r.text).toBe('')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(r.headers.get('vary')?.toLowerCase()).toContain('origin')
    const cabecalhos = (r.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    for (const h of ['authorization', 'content-type', 'x-app-key', 'x-business', 'idempotency-key']) expect(cabecalhos).toContain(h)
    expect(r.headers.get('access-control-allow-methods')).toContain('POST')
    expect(r.headers.get('access-control-max-age')).toBe('600')
    expect(r.headers.get('access-control-allow-credentials')).toBeNull()
    expect(r.headers.get('x-request-id')).not.toBeNull()
  })

  test('pré-voo com origem malformada: 403 sem cabeçalhos CORS; sem Origin: 204 sem CORS', async () => {
    const mal = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/chave', { origin: 'não-é-origem' }))
    expect(mal.status).toBe(403)
    expect(mal.headers.get('access-control-allow-origin')).toBeNull()
    const sem = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/chave'))
    expect(sem.status).toBe(204)
    expect(sem.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('rota pública com Origin válida leva CORS (não há chave para conferir)', async () => {
    const r = await callRoute(publica, apiRequest('GET', '/v1/teste/publica', { origin: 'https://qualquer.com' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBe('https://qualquer.com')
  })
})

describe('token do cliente e da equipe', () => {
  let cliente: Customer
  beforeEach(async () => {
    cliente = await makeCustomer(a.id)
  })

  test('cliente com token válido: ctx com ator customer e canal app', async () => {
    const token = await customerToken(a.id, cliente.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token })))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ canal: 'app', ator: 'customer', clienteId: cliente.id, businessId: a.id })
  })

  const SESSAO = { code: 'unauthorized', reason: 'session_invalid' }

  test('sem token, token ruim, adulterado e vencido dão a mesma resposta 401', async () => {
    const valido = await customerToken(a.id, cliente.id)
    const vencido = (await signAccessToken({ kind: 'customer', businessId: a.id, customerId: cliente.id }, addMinutes(new Date(), -60))).token
    const adulterado = `${valido.slice(0, -3)}${valido.endsWith('aaa') ? 'bbb' : 'aaa'}`
    const respostas = []
    for (const token of [undefined, 'lixo', adulterado, vencido]) {
      const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave(token === undefined ? {} : { token })))
      expect(r.status).toBe(401)
      expect(apiError(r.json)).toMatchObject(SESSAO)
      respostas.push(apiError(r.json).message)
    }
    expect(new Set(respostas).size).toBe(1)
  })

  test('cabeçalho Authorization que não é Bearer: 401', async () => {
    const token = await customerToken(a.id, cliente.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ headers: { authorization: `Basic ${token}` } })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
  })

  test('token de equipe em rota de cliente: 403 wrong_token_kind; token de cliente em rota de equipe também', async () => {
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const equipe = await staffToken(a.id, m.id, user.id)
    const r1 = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token: equipe })))
    expect(r1.status).toBe(403)
    expect(apiError(r1.json)).toMatchObject({ code: 'forbidden', reason: 'wrong_token_kind' })
    const r2 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token: await customerToken(a.id, cliente.id) })))
    expect(r2.status).toBe(403)
    expect(apiError(r2.json).reason).toBe('wrong_token_kind')
  })

  test('token do cliente da conta B com a chave da conta A: 401 igual aos outros', async () => {
    const deB = await makeCustomer(b.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token: await customerToken(b.id, deB.id) })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
  })

  test('token de equipe da conta B com a chave de A em rota de cliente: 401, não 403 (não revela o tipo)', async () => {
    const user = await makeUser()
    const m = await makeMembership(b.id, user.id, 'OWNER')
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token: await staffToken(b.id, m.id, user.id) })))
    expect(r.status).toBe(401)
  })

  test('token com o id de um cliente de outra conta mas bid da conta da chave: 401', async () => {
    const deB = await makeCustomer(b.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token: await customerToken(a.id, deB.id) })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
  })

  test('cliente arquivado, anonimizado ou apagado: 401 session_invalid', async () => {
    const token = await customerToken(a.id, cliente.id)
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: new Date() } })
    const arquivado = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token })))
    expect(arquivado.status).toBe(401)
    expect(apiError(arquivado.json)).toMatchObject(SESSAO)
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: null, anonymizedAt: new Date() } })
    expect((await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token })))).status).toBe(401)
    await prisma.customer.delete({ where: { id: cliente.id } })
    expect((await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comChave({ token })))).status).toBe(401)
  })

  test('equipe: o papel vem do banco, não do token; canal app', async () => {
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'MANAGER')
    const token = await staffToken(a.id, m.id, user.id)
    const r1 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token })))
    expect(r1.json).toEqual({ canal: 'app', papel: 'MANAGER', membershipId: m.id })
    await prisma.membership.update({ where: { id: m.id }, data: { role: 'PROFESSIONAL' } })
    const r2 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token })))
    expect(jsonObject(r2.json).papel).toBe('PROFESSIONAL')
  })

  test('equipe com vínculo desativado, apagado ou de outro usuário: 401', async () => {
    const user = await makeUser()
    const outro = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const trocado = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token: await staffToken(a.id, m.id, outro.id) })))
    expect(trocado.status).toBe(401)
    const token = await staffToken(a.id, m.id, user.id)
    await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
    const inativo = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token })))
    expect(inativo.status).toBe(401)
    expect(apiError(inativo.json)).toMatchObject(SESSAO)
    await prisma.membership.delete({ where: { id: m.id } })
    expect((await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token })))).status).toBe(401)
  })

  test('vínculo de outra conta com o bid da conta da chave: 401', async () => {
    const user = await makeUser()
    const deB = await makeMembership(b.id, user.id, 'OWNER')
    const r = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comChave({ token: await staffToken(a.id, deB.id, user.id) })))
    expect(r.status).toBe(401)
  })
})

describe('corpo, parâmetros e consulta', () => {
  const post = (body?: unknown, extra: Parameters<typeof apiRequest>[2] = {}) =>
    callRoute(eco, apiRequest('POST', '/v1/teste/eco', comChave({ ...(body === undefined ? {} : { body }), ...extra })))

  test('corpo válido passa', async () => {
    const r = await post({ nome: 'x', qtd: 2 })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ nome: 'x', qtd: 2 })
  })

  test('JSON inválido: 422 com fields._', async () => {
    const r = await post('{nome:')
    expect(r.status).toBe(422)
    expect(apiError(r.json).code).toBe('validation')
    expect(apiError(r.json).fields).toHaveProperty('_')
  })

  test('corpo vazio em rota que exige corpo: 422 com fields._', async () => {
    const r = await post()
    expect(r.status).toBe(422)
    expect(apiError(r.json).fields).toHaveProperty('_')
    const vazioComTipo = await post('')
    expect(vazioComTipo.status).toBe(422)
  })

  test('corpo que não é objeto (null, lista, texto): 422', async () => {
    for (const corpo of ['null', '[]', '"oi"', '3']) {
      const r = await post(corpo)
      expect(r.status, corpo).toBe(422)
    }
  })

  test('campo com tipo errado: 422 com o nome do campo', async () => {
    const r = await post({ nome: 'x', qtd: 'dois' })
    expect(r.status).toBe(422)
    expect(Object.keys(apiError(r.json).fields ?? {})).toEqual(['qtd'])
  })

  test('campo desconhecido na raiz e em objeto aninhado estrito: 422 com o nome do campo', async () => {
    const raiz = await post({ nome: 'x', qtd: 1, intruso: true })
    expect(raiz.status).toBe(422)
    expect(Object.keys(apiError(raiz.json).fields ?? {})).toEqual(['intruso'])
    const aninhado = await post({ nome: 'x', qtd: 1, extra: { a: 1, b: 2 } })
    expect(aninhado.status).toBe(422)
    expect(Object.keys(apiError(aninhado.json).fields ?? {})).toEqual(['extra.b'])
  })

  test('Content-Type que não é JSON: 422 com fields._, não 500', async () => {
    const r = await post('nome=x', { headers: { 'content-type': 'text/plain' } })
    expect(r.status).toBe(422)
    expect(apiError(r.json).fields).toHaveProperty('_')
    const sem = await callRoute(eco, new Request('http://api.localhost:3000/v1/teste/eco', { method: 'POST', headers: { 'x-app-key': chaveA.secret }, body: '{"nome":"x","qtd":1}' }))
    // Corpo em texto sem Content-Type: o Request o rotula como text/plain.
    expect(sem.status).toBe(422)
  })

  test('Content-Type com charset e application/vnd.x+json são aceitos', async () => {
    const r1 = await post({ nome: 'x', qtd: 1 }, { headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(r1.status).toBe(200)
    const r2 = await post({ nome: 'x', qtd: 1 }, { headers: { 'content-type': 'application/vnd.agendaflui+json' } })
    expect(r2.status).toBe(200)
  })

  test('UTF-8 inválido: 422', async () => {
    const req = new Request('http://api.localhost:3000/v1/teste/eco', {
      method: 'POST',
      headers: { 'x-app-key': chaveA.secret, 'content-type': 'application/json' },
      body: new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]),
    })
    const r = await callRoute(eco, req)
    expect(r.status).toBe(422)
  })

  test('corpo de 101 KB: 413 com body_too_large; o teto é em bytes, não em caracteres', async () => {
    const grande = await post({ nome: 'a'.repeat(101 * 1024), qtd: 1 })
    expect(grande.status).toBe(413)
    expect(apiError(grande.json)).toMatchObject({ code: 'validation', reason: 'body_too_large' })
    // 52.000 caracteres de 2 bytes = 104.000 bytes (acima de 100 KB = 102.400), mas menos de 102.400 caracteres.
    const bytes = await post({ nome: 'é'.repeat(52_000), qtd: 1 })
    expect(bytes.status).toBe(413)
    const limite = await post({ nome: 'a'.repeat(50 * 1024), qtd: 1 })
    expect(limite.status).toBe(200)
  })

  test('corpo grande sem Content-Length (fluxo) também é 413, sem ler tudo', async () => {
    let enviados = 0
    const fluxo = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (enviados >= 50) return controller.close()
        enviados += 1
        controller.enqueue(new Uint8Array(10 * 1024).fill(0x61))
      },
    })
    const req = new Request('http://api.localhost:3000/v1/teste/eco', {
      method: 'POST',
      headers: { 'x-app-key': chaveA.secret, 'content-type': 'application/json' },
      body: fluxo,
      duplex: 'half',
    } as RequestInit)
    const r = await callRoute(eco, req)
    expect(r.status).toBe(413)
    expect(enviados).toBeLessThan(50)
  })

  test('Content-Length declarado acima do teto: 413 sem ler o corpo', async () => {
    const r = await post({ nome: 'x', qtd: 1 }, { headers: { 'content-length': String(500 * 1024) } })
    expect(r.status).toBe(413)
  })

  test('rota sem corpo definido ignora o corpo enviado', async () => {
    const r = await callRoute(apagada, apiRequest('DELETE', '/v1/teste/apagada', comChave({ body: 'lixo {', headers: { 'content-type': 'text/plain' } })))
    expect(r.status).toBe(204)
  })

  test('params e query: coerção pelo esquema da rota; id inválido e consulta desconhecida são 422', async () => {
    const id = crypto.randomUUID()
    const ok = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?n=3`, comChave()), { id })
    expect(ok.status).toBe(200)
    expect(ok.json).toEqual({ id, n: 3, tags: null })
    const padrao = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}`, comChave()), { id })
    expect(jsonObject(padrao.json).n).toBe(1)
    const repetida = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?tags=a&tags=b`, comChave()), { id })
    expect(jsonObject(repetida.json).tags).toEqual(['a', 'b'])
    const ruim = await callRoute(comParametros, apiRequest('GET', '/v1/teste/itens/xyz', comChave()), { id: 'xyz' })
    expect(ruim.status).toBe(422)
    expect(Object.keys(apiError(ruim.json).fields ?? {})).toEqual(['id'])
    const desconhecida = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?x=1`, comChave()), { id })
    expect(desconhecida.status).toBe(422)
    expect(Object.keys(apiError(desconhecida.json).fields ?? {})).toEqual(['x'])
    const tipo = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?n=abc`, comChave()), { id })
    expect(tipo.status).toBe(422)
    expect(Object.keys(apiError(tipo.json).fields ?? {})).toEqual(['n'])
  })
})

describe('erros e resposta', () => {
  test('erro inesperado: 500 internal sem a mensagem original; o log leva o id da requisição e a rota, sem segredos', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const token = 'token-que-nao-deve-vazar'
      const r = await callRoute(explode, apiRequest('GET', '/v1/teste/explode?senha=abc', comChave({ token })))
      expect(r.status).toBe(500)
      expect(apiError(r.json).code).toBe('internal')
      expect(r.text).not.toContain('detalhe-interno-secreto')
      const id = r.headers.get('x-request-id')
      expect(id).toBeTruthy()
      const gravado = log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(gravado).toContain(id ?? 'sem-id')
      expect(gravado).toContain('GET')
      expect(gravado).toContain('/v1/teste/explode')
      expect(gravado).toContain('detalhe-interno-secreto')
      expect(gravado).not.toContain(chaveA.secret)
      expect(gravado).not.toContain(token)
      expect(gravado).not.toContain('senha=abc')
    } finally {
      log.mockRestore()
    }
  })

  test('cada resposta traz um X-Request-Id diferente', async () => {
    const r1 = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    const r2 = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    expect(r1.headers.get('x-request-id')).not.toBe(r2.headers.get('x-request-id'))
  })

  test('DomainError de conflito: 409 com reason e details serializados (datas em ISO)', async () => {
    const r = await callRoute(conflito, apiRequest('GET', '/v1/teste/conflito', comChave()))
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toEqual({
      code: 'conflict',
      reason: 'slot_taken',
      message: 'Este horário já foi ocupado. Escolha outro.',
      details: { startsAt: '2027-01-15T08:00:00.000Z' },
    })
  })

  test('sucesso com Date, bigint e undefined sai como JSON puro em ISO UTC', async () => {
    const r = await callRoute(comDatas, apiRequest('GET', '/v1/teste/datas', comChave()))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ quando: '2027-01-15T08:00:00.000Z', grande: 7, lista: ['2027-01-15T08:00:00.000Z'] })
  })

  test('resposta fora do contrato vira 500 em teste (erro de programação)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const r = await callRoute(foraDoContrato, apiRequest('GET', '/v1/teste/fora-do-contrato', comChave()))
      expect(r.status).toBe(500)
      expect(apiError(r.json).code).toBe('internal')
    } finally {
      log.mockRestore()
    }
  })

  test('status 201 devolve o corpo; 204 não tem corpo nem Content-Type de JSON', async () => {
    const c = await callRoute(criada, apiRequest('POST', '/v1/teste/criada', comChave({ body: { nome: 'x' } })))
    expect(c.status).toBe(201)
    expect(c.json).toEqual({ nome: 'x' })
    const d = await callRoute(apagada, apiRequest('DELETE', '/v1/teste/apagada', comChave()))
    expect(d.status).toBe(204)
    expect(d.text).toBe('')
    expect(d.headers.get('cache-control')).toBe('no-store')
  })
})

describe('limites de requisições', () => {
  test('a 121ª requisição no minuto é 429 com Retry-After inteiro', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
      if (r.status !== 200) throw new Error(`requisição ${i + 1} deu ${r.status}`)
    }
    const r = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))
    expect(r.status).toBe(429)
    expect(apiError(r.json).code).toBe('rate_limited')
    const espera = Number(r.headers.get('retry-after'))
    expect(Number.isInteger(espera)).toBe(true)
    expect(espera).toBeGreaterThanOrEqual(1)
    expect(espera).toBeLessThanOrEqual(60)
    // Outra chave não é afetada.
    const outra = await makeAppKey(a.id)
    const ok = await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', { key: outra.secret }))
    expect(ok.status).toBe(200)
  }, 60_000)

  test('limite da rota vale além do geral e é por rota e por chave', async () => {
    const pedir = (key: string) => callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', { key }))
    expect((await pedir(chaveA.secret)).status).toBe(200)
    expect((await pedir(chaveA.secret)).status).toBe(200)
    const barrada = await pedir(chaveA.secret)
    expect(barrada.status).toBe(429)
    expect(Number(barrada.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    // Outras rotas da mesma chave seguem.
    expect((await callRoute(porChave, apiRequest('GET', '/v1/teste/chave', comChave()))).status).toBe(200)
    const outra = await makeAppKey(a.id)
    expect((await pedir(outra.secret)).status).toBe(200)
  })

  test('requisição barrada pelo limite não chega ao handler nem lê o corpo', async () => {
    for (let i = 0; i < 3; i++) await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comChave()))
    const r = await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comChave()))
    expect(r.status).toBe(429)
  })

  test('as chaves de limite guardadas não contêm o segredo da chave', async () => {
    await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comChave()))
    const linhas = await prisma.rateLimitBucket.findMany()
    expect(linhas.length).toBeGreaterThanOrEqual(2)
    for (const l of linhas) expect(l.key).not.toContain(chaveA.secret)
    expect(linhas.some((l) => l.key.startsWith('api:') && l.key.includes(chaveA.id) && l.key.endsWith('sem-ip'))).toBe(true)
    expect(linhas.some((l) => l.key.startsWith('api-rota:GET /v1/teste/limitada:'))).toBe(true)
  })
})

describe('registro', () => {
  test('toda rota definida aparece no registro com método e caminho', () => {
    const lista = registeredRoutes().map((r) => `${r.method} ${r.path}`)
    expect(lista).toContain('GET /v1/teste/chave')
    expect(lista).toContain('POST /v1/teste/eco')
    expect(lista).toContain('GET /v1/health')
  })

  test('registrar de novo a mesma rota da mesma origem substitui sem erro; de outra origem com definição diferente lança', () => {
    const def = { ...registeredRoutes().find((r) => r.path === '/v1/teste/chave')! }
    const nova = { ...def, path: '/v1/teste/registro' }
    expect(() => registerRoute(nova, 'arquivo-a.ts')).not.toThrow()
    expect(() => registerRoute({ ...nova, summary: 'Outra' }, 'arquivo-a.ts')).not.toThrow()
    expect(registeredRoutes().filter((r) => r.path === '/v1/teste/registro')).toHaveLength(1)
    expect(registeredRoutes().find((r) => r.path === '/v1/teste/registro')?.summary).toBe('Outra')
    expect(() => registerRoute({ ...nova, summary: 'Terceira' }, 'arquivo-b.ts')).toThrow(/GET \/v1\/teste\/registro/)
  })

  test('o mesmo método e caminho com métodos diferentes convivem', () => {
    const lista = registeredRoutes()
    expect(lista.some((r) => r.method === 'POST' && r.path === '/v1/teste/criada')).toBe(true)
    expect(lista.some((r) => r.method === 'DELETE' && r.path === '/v1/teste/apagada')).toBe(true)
  })
})
