import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as healthGet } from '@/app/api/v1/health/route'
import { defineRoute, preflight } from '@/server/api/define-route'
import { webOriginsFromEnv } from '@/server/api/cors'
import { isoInstant, uuid } from '@/server/api/wire'
import { signAccessToken } from '@/server/auth/api-tokens'
import type { Business, Customer } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { DomainError, z } from '@/server/domain/errors'
import { addMinutes } from '@/server/time'
import { apiError, apiRequest, callRoute, customerToken, jsonObject, staffToken } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let chamadas = 0
const vazio = z.object({})

const publica = defineRoute({
  method: 'GET',
  path: '/v1/teste/publica',
  auth: 'none',
  summary: 'Rota pública',
  tag: 'teste',
  response: z.object({ ok: z.literal(true), temConta: z.boolean(), temContexto: z.boolean() }),
  handler: async ({ ctx, business }) => {
    chamadas += 1
    return { ok: true as const, temConta: business !== null, temContexto: ctx !== null }
  },
})

const porConta = defineRoute({
  method: 'GET',
  path: '/v1/teste/conta',
  auth: 'guest',
  summary: 'Rota só com conta',
  tag: 'teste',
  response: z.object({
    businessId: z.string(),
    slug: z.string(),
    timeZone: z.string(),
    ator: z.string(),
    canal: z.string(),
    ctxTimeZone: z.string(),
    ctxBusinessId: z.string(),
  }),
  handler: async ({ ctx, business }) => {
    chamadas += 1
    return {
      businessId: business.id,
      slug: business.slug,
      timeZone: business.timeZone,
      ator: ctx.actor.kind,
      canal: ctx.channel,
      ctxTimeZone: ctx.timeZone,
      ctxBusinessId: ctx.businessId,
    }
  },
})

const visitanteOuCliente = defineRoute({
  method: 'GET',
  path: '/v1/teste/visitante-ou-cliente',
  auth: 'guest_or_customer',
  summary: 'Visitante ou cliente',
  tag: 'teste',
  response: z.object({ ator: z.string(), clienteId: z.string().nullable(), canal: z.string() }),
  handler: async ({ ctx }) => {
    chamadas += 1
    return { ator: ctx.actor.kind, clienteId: ctx.actor.kind === 'customer' ? ctx.actor.customerId : null, canal: ctx.channel }
  },
})

const statusNaoDeclarado = defineRoute({
  method: 'POST',
  path: '/v1/teste/status-nao-declarado',
  auth: 'guest',
  status: 201,
  alternateStatuses: [200],
  summary: 'Pede um status que não declarou',
  tag: 'teste',
  response: z.object({ ok: z.boolean() }),
  handler: async ({ setStatus }) => {
    setStatus(202)
    return { ok: true }
  },
})

const limitadaPorSujeito = defineRoute({
  method: 'POST',
  path: '/v1/teste/limitada-por-sujeito',
  auth: 'customer',
  summary: 'Limite por cliente',
  tag: 'teste',
  limit: { limit: 2, windowSec: 60 },
  limitBy: 'subject',
  response: vazio,
  handler: async () => {
    chamadas += 1
    return {}
  },
})

const statusDinamico = defineRoute({
  method: 'POST',
  path: '/v1/teste/status-dinamico',
  auth: 'guest',
  status: 201,
  alternateStatuses: [200],
  summary: 'Status escolhido pelo handler',
  tag: 'teste',
  body: z.object({ repetido: z.boolean() }),
  response: z.object({ ok: z.boolean() }),
  handler: async ({ body, setStatus }) => {
    if (body.repetido) setStatus(200)
    return { ok: true }
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
    chamadas += 1
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
    chamadas += 1
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
  auth: 'guest',
  summary: 'Devolve o corpo',
  tag: 'teste',
  body: z.object({ nome: z.string().min(1), qtd: z.number().int(), extra: z.strictObject({ a: z.number().optional() }).optional() }),
  response: z.object({ nome: z.string(), qtd: z.number(), extra: z.object({ a: z.number().optional() }).optional() }),
  handler: async ({ body }) => {
    chamadas += 1
    return { ...body }
  },
})

const comParametros = defineRoute({
  method: 'GET',
  path: '/v1/teste/itens/{id}',
  auth: 'guest',
  summary: 'Parâmetros e consulta',
  tag: 'teste',
  params: z.object({ id: z.uuid() }),
  query: z.object({ n: z.coerce.number().int().min(1).default(1), tags: z.union([z.string(), z.array(z.string())]).optional() }),
  response: z.object({ id: uuid, n: z.number(), tags: z.union([z.string(), z.array(z.string())]).nullable() }),
  handler: async ({ params, query }) => ({ id: params.id, n: query.n, tags: query.tags ?? null }),
})

const explode = defineRoute({
  method: 'GET',
  path: '/v1/teste/explode',
  auth: 'guest',
  summary: 'Erro inesperado',
  tag: 'teste',
  response: vazio,
  handler: async () => {
    throw new Error('detalhe-interno-secreto')
  },
})

const conflito = defineRoute({
  method: 'GET',
  path: '/v1/teste/conflito',
  auth: 'guest',
  summary: 'Erro de domínio',
  tag: 'teste',
  response: vazio,
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
  auth: 'guest',
  summary: 'Datas na resposta',
  tag: 'teste',
  response: z.object({ quando: isoInstant, grande: z.number(), nada: z.string().optional(), lista: z.array(isoInstant) }),
  handler: async () => {
    const quando = addMinutes(new Date(1_800_000_000_000), 0)
    return { quando, grande: 7n, nada: undefined, lista: [quando] }
  },
})

const foraDoContrato = defineRoute({
  method: 'GET',
  path: '/v1/teste/fora-do-contrato',
  auth: 'guest',
  summary: 'Resposta fora do contrato',
  tag: 'teste',
  response: z.object({ n: z.number() }),
  handler: async () => ({ n: 'não é número' }) as unknown as { n: number },
})

const campoExtra = defineRoute({
  method: 'GET',
  path: '/v1/teste/campo-extra',
  auth: 'guest',
  summary: 'Campo a mais na raiz',
  tag: 'teste',
  response: z.object({ n: z.number() }),
  handler: async () => ({ n: 1, vazou: 'x' }) as { n: number },
})

const campoExtraAninhado = defineRoute({
  method: 'GET',
  path: '/v1/teste/campo-extra-aninhado',
  auth: 'guest',
  summary: 'Campo a mais em objeto aninhado dentro de lista',
  tag: 'teste',
  response: z.object({ itens: z.array(z.object({ id: z.string() })) }),
  handler: async () => ({ itens: [{ id: 'a' }, { id: 'b', senha: 'x' }] }) as { itens: { id: string }[] },
})

const detalhesImpossiveis = defineRoute({
  method: 'GET',
  path: '/v1/teste/detalhes-impossiveis',
  auth: 'guest',
  summary: 'DomainError com details que não serializa',
  tag: 'teste',
  response: vazio,
  handler: async () => {
    throw new DomainError('conflict', 'Conflito.', { details: { mapa: new Map() } })
  },
})

const comDataIso = defineRoute({
  method: 'GET',
  path: '/v1/teste/data-iso',
  auth: 'guest',
  summary: 'Data com esquema de fio',
  tag: 'teste',
  response: z.object({ quando: isoInstant }),
  handler: async () => ({ quando: new Date(1_800_000_000_000) }),
})

const publicaLimitada = defineRoute({
  method: 'POST',
  path: '/v1/teste/publica-limitada',
  auth: 'none',
  summary: 'Pública com limite próprio',
  tag: 'teste',
  limit: { limit: 2, windowSec: 60 },
  response: vazio,
  handler: async () => {
    chamadas += 1
    return {}
  },
})

const limitada = defineRoute({
  method: 'GET',
  path: '/v1/teste/limitada',
  auth: 'guest',
  summary: 'Limite próprio',
  tag: 'teste',
  limit: { limit: 2, windowSec: 60 },
  response: vazio,
  handler: async () => {
    chamadas += 1
    return {}
  },
})

const criada = defineRoute({
  method: 'POST',
  path: '/v1/teste/criada',
  auth: 'guest',
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
  auth: 'guest',
  status: 204,
  summary: 'Apagada',
  tag: 'teste',
  response: z.undefined(),
  handler: async () => undefined,
})

let a: Business
let b: Business
const ORIGEM = 'https://app.exemplo.com'
const ORIGENS_ENV = process.env.APP_WEB_ORIGINS

beforeEach(async () => {
  chamadas = 0
  await resetDb()
  a = await makeBusiness()
  b = await makeBusiness()
  process.env.APP_WEB_ORIGINS = ORIGEM
})

afterEach(() => {
  if (ORIGENS_ENV === undefined) delete process.env.APP_WEB_ORIGINS
  else process.env.APP_WEB_ORIGINS = ORIGENS_ENV
})

const comConta = (o: Parameters<typeof apiRequest>[2] = {}) => ({ business: a.slug, ...o })

describe('conta pelo cabeçalho X-Business', () => {
  test('sem X-Business: 401 unknown_business, com Content-Type, no-store e X-Request-Id', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta'))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'unknown_business' })
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(chamadas).toBe(0)
  })

  test('X-Business com conta que não existe, vazio ou enorme: 401 unknown_business, a mesma mensagem do cabeçalho ausente', async () => {
    const ausente = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta'))
    for (const slug of ['conta-que-nao-existe', '', '   ', 'a'.repeat(500)]) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: slug }))
      expect(r.status, slug.slice(0, 20)).toBe(401)
      expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'unknown_business' })
      expect(apiError(r.json).message).toBe(apiError(ausente.json).message)
    }
    expect(chamadas).toBe(0)
  })

  test('a conta é a do cabeçalho: o slug em maiúsculas também acha a conta', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: b.slug.toUpperCase() }))
    expect(r.status).toBe(200)
    expect(jsonObject(r.json).businessId).toBe(b.id)
  })

  test('rota com conta: o handler recebe a conta e o contexto de visitante (canal app, fuso da conta)', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      businessId: a.id,
      slug: a.slug,
      timeZone: a.timezone,
      ator: 'guest',
      canal: 'app',
      ctxTimeZone: a.timezone,
      ctxBusinessId: a.id,
    })
  })

  test('o contexto de visitante usa o cliente por conta: lê só a conta do cabeçalho', async () => {
    const tz = defineRoute({
      method: 'GET',
      path: '/v1/teste/visitante-le',
      auth: 'guest',
      summary: 'Lê com o contexto do visitante',
      tag: 'teste',
      response: z.object({ clientes: z.number() }),
      handler: async ({ ctx }) => ({ clientes: await ctx.db.customer.count() }),
    })
    await makeCustomer(a.id)
    await makeCustomer(a.id)
    await makeCustomer(b.id)
    const r = await callRoute(tz, apiRequest('GET', '/v1/teste/visitante-le', comConta()))
    expect(r.json).toEqual({ clientes: 2 })
  })

  test('conta suspensa: 503 business_unavailable', async () => {
    await prisma.business.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } })
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(r.status).toBe(503)
    expect(apiError(r.json).code).toBe('business_unavailable')
  })

  test('rota pública: responde sem X-Business, sem conta nem contexto no handler', async () => {
    const r = await callRoute(publica, apiRequest('GET', '/v1/teste/publica'))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true, temConta: false, temContexto: false })
  })

  test('GET /v1/health responde sem conta', async () => {
    const r = await callRoute(healthGet, apiRequest('GET', '/v1/health'))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ status: 'ok' })
    expect(r.headers.get('x-request-id')).not.toBeNull()
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
})

describe('CORS', () => {
  test('sem Origin (app nativo) segue, sem cabeçalhos CORS', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(r.headers.get('access-control-expose-headers')).toBeNull()
  })

  test('origem da lista APP_WEB_ORIGINS: ecoa a origem, Vary: Origin e nunca credenciais nem *', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: ORIGEM })))
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(r.headers.get('vary')?.toLowerCase()).toContain('origin')
    expect(r.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('a lista aceita várias origens separadas por vírgula; a comparação é exata', async () => {
    process.env.APP_WEB_ORIGINS = `${ORIGEM}, https://outro.exemplo.com/`
    const ok = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: 'https://outro.exemplo.com' })))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://outro.exemplo.com')
    for (const falsa of ['https://app.exemplo.com.evil.com', 'http://app.exemplo.com', 'https://app.exemplo.com:8443', 'https://x.app.exemplo.com']) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: falsa })))
      expect(r.status, falsa).toBe(403)
    }
  })

  test('localhost e *.localhost (qualquer porta) passam fora de produção; imitações não', async () => {
    for (const local of ['http://localhost:5173', 'http://loja.localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: local })))
      expect(r.status, local).toBe(200)
      expect(r.headers.get('access-control-allow-origin')).toBe(local)
    }
    for (const falsa of ['http://localhost.evil.com:5173', 'http://loja.localhost.evil.com:5173', 'http://evil-localhost:5173']) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: falsa })))
      expect(r.status, falsa).toBe(403)
    }
  })

  test('em produção localhost é recusado e só a lista vale (webOriginsFromEnv)', () => {
    const prod = webOriginsFromEnv({ NODE_ENV: 'production', APP_WEB_ORIGINS: ORIGEM })
    expect(prod).toEqual({ origins: [ORIGEM], allowLocalhost: false })
    expect(webOriginsFromEnv({ NODE_ENV: 'development', APP_WEB_ORIGINS: ORIGEM }).allowLocalhost).toBe(true)
  })

  test('origem fora da lista em rota com conta: 403 origin_not_allowed, sem CORS, sem chegar ao handler', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: 'https://outro.com' })))
    expect(r.status).toBe(403)
    expect(apiError(r.json)).toMatchObject({ code: 'forbidden', reason: 'origin_not_allowed' })
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(r.headers.get('vary')?.toLowerCase()).toContain('origin')
    expect(chamadas).toBe(0)
  })

  test('lista vazia: qualquer origem web (menos localhost) é recusada, mas o app nativo (sem Origin) passa', async () => {
    delete process.env.APP_WEB_ORIGINS
    const web = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: ORIGEM })))
    expect(web.status).toBe(403)
    const nativo = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(nativo.status).toBe(200)
  })

  test('origem fora da lista é recusada antes de procurar a conta (não revela se ela existe)', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: 'nao-existe', origin: 'https://outro.com' }))
    expect(r.status).toBe(403)
    expect(apiError(r.json).reason).toBe('origin_not_allowed')
  })

  test('erro de rota depois da checagem de origem também leva os cabeçalhos CORS', async () => {
    const r = await callRoute(conflito, apiRequest('GET', '/v1/teste/conflito', comConta({ origin: ORIGEM })))
    expect(r.status).toBe(409)
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
  })

  test('X-Business ausente com origem permitida: o 401 unknown_business leva CORS (o navegador consegue ler o erro)', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { origin: ORIGEM }))
    expect(r.status).toBe(401)
    expect(apiError(r.json).reason).toBe('unknown_business')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
  })

  test('as respostas expõem Retry-After e X-Request-Id ao navegador', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ origin: ORIGEM })))
    const expostos = (r.headers.get('access-control-expose-headers') ?? '').toLowerCase()
    expect(expostos).toContain('retry-after')
    expect(expostos).toContain('x-request-id')
  })

  test('pré-voo de origem da lista: 204 com origem, métodos, cabeçalhos (x-business, sem x-app-key) e Max-Age', async () => {
    const r = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/conta', { origin: ORIGEM, headers: { 'access-control-request-method': 'POST' } }))
    expect(r.status).toBe(204)
    expect(r.text).toBe('')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(r.headers.get('vary')?.toLowerCase()).toContain('origin')
    const cabecalhos = (r.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    for (const h of ['authorization', 'content-type', 'x-business', 'idempotency-key']) expect(cabecalhos).toContain(h)
    expect(cabecalhos).not.toContain('x-app-key')
    expect(r.headers.get('access-control-allow-methods')).toContain('POST')
    expect(r.headers.get('access-control-max-age')).toBe('600')
    expect(r.headers.get('access-control-allow-credentials')).toBeNull()
    expect(r.headers.get('x-request-id')).not.toBeNull()
  })

  test('pré-voo de localhost fora de produção: 204 com CORS', async () => {
    const r = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/conta', { origin: 'http://localhost:5173' }))
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  test('pré-voo de origem de fora da lista: 403 origin_not_allowed sem cabeçalhos CORS', async () => {
    const r = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/conta', { origin: 'https://outro.com' }))
    expect(r.status).toBe(403)
    expect(apiError(r.json).reason).toBe('origin_not_allowed')
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(r.headers.get('access-control-allow-methods')).toBeNull()
  })

  test('pré-voo com origem malformada: 403 sem cabeçalhos CORS; sem Origin: 204 sem CORS', async () => {
    const mal = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/conta', { origin: 'não-é-origem' }))
    expect(mal.status).toBe(403)
    expect(mal.headers.get('access-control-allow-origin')).toBeNull()
    const sem = await callRoute(preflight, apiRequest('OPTIONS', '/v1/teste/conta'))
    expect(sem.status).toBe(204)
    expect(sem.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('rota pública (none) com origem de fora responde normal, mas sem CORS; com origem da lista leva CORS', async () => {
    const fora = await callRoute(publica, apiRequest('GET', '/v1/teste/publica', { origin: 'https://qualquer.com' }))
    expect(fora.status).toBe(200)
    expect(fora.headers.get('access-control-allow-origin')).toBeNull()
    expect(fora.headers.get('vary')?.toLowerCase()).toContain('origin')
    const dentro = await callRoute(publica, apiRequest('GET', '/v1/teste/publica', { origin: ORIGEM }))
    expect(dentro.status).toBe(200)
    expect(dentro.headers.get('access-control-allow-origin')).toBe(ORIGEM)
  })
})

describe('token do cliente e da equipe', () => {
  let cliente: Customer
  beforeEach(async () => {
    cliente = await makeCustomer(a.id)
  })

  test('cliente com token válido: ctx com ator customer e canal app', async () => {
    const token = await customerToken(a.id, cliente.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token })))
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
      const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta(token === undefined ? {} : { token })))
      expect(r.status).toBe(401)
      expect(apiError(r.json)).toMatchObject(SESSAO)
      respostas.push(apiError(r.json).message)
    }
    expect(new Set(respostas).size).toBe(1)
  })

  test('cabeçalho Authorization que não é Bearer: 401', async () => {
    const token = await customerToken(a.id, cliente.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ headers: { authorization: `Basic ${token}` } })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
  })

  test('token de equipe em rota de cliente: 403 wrong_token_kind; token de cliente em rota de equipe também', async () => {
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const equipe = await staffToken(a.id, m.id, user.id)
    const r1 = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token: equipe })))
    expect(r1.status).toBe(403)
    expect(apiError(r1.json)).toMatchObject({ code: 'forbidden', reason: 'wrong_token_kind' })
    const r2 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token: await customerToken(a.id, cliente.id) })))
    expect(r2.status).toBe(403)
    expect(apiError(r2.json).reason).toBe('wrong_token_kind')
    expect(chamadas).toBe(0)
  })

  test('token do cliente da conta B com X-Business da conta A: 401 igual aos outros', async () => {
    const deB = await makeCustomer(b.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token: await customerToken(b.id, deB.id) })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
    expect(chamadas).toBe(0)
  })

  test('token de equipe da conta B com X-Business de A em rota de cliente: 401, não 403 (não revela o tipo)', async () => {
    const user = await makeUser()
    const m = await makeMembership(b.id, user.id, 'OWNER')
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token: await staffToken(b.id, m.id, user.id) })))
    expect(r.status).toBe(401)
  })

  test('token com o id de um cliente de outra conta mas bid da conta do cabeçalho: 401', async () => {
    const deB = await makeCustomer(b.id)
    const r = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token: await customerToken(a.id, deB.id) })))
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject(SESSAO)
  })

  test('cliente arquivado, anonimizado ou apagado: 401 session_invalid', async () => {
    const token = await customerToken(a.id, cliente.id)
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: new Date() } })
    const arquivado = await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token })))
    expect(arquivado.status).toBe(401)
    expect(apiError(arquivado.json)).toMatchObject(SESSAO)
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: null, anonymizedAt: new Date() } })
    expect((await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token })))).status).toBe(401)
    await prisma.customer.delete({ where: { id: cliente.id } })
    expect((await callRoute(doCliente, apiRequest('GET', '/v1/teste/cliente', comConta({ token })))).status).toBe(401)
  })

  test('equipe: o papel vem do banco, não do token; canal app', async () => {
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'MANAGER')
    const token = await staffToken(a.id, m.id, user.id)
    const r1 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token })))
    expect(r1.json).toEqual({ canal: 'app', papel: 'MANAGER', membershipId: m.id })
    await prisma.membership.update({ where: { id: m.id }, data: { role: 'PROFESSIONAL' } })
    const r2 = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token })))
    expect(jsonObject(r2.json).papel).toBe('PROFESSIONAL')
  })

  test('equipe com vínculo desativado, apagado ou de outro usuário: 401', async () => {
    const user = await makeUser()
    const outro = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const trocado = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token: await staffToken(a.id, m.id, outro.id) })))
    expect(trocado.status).toBe(401)
    const token = await staffToken(a.id, m.id, user.id)
    await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
    const inativo = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token })))
    expect(inativo.status).toBe(401)
    expect(apiError(inativo.json)).toMatchObject(SESSAO)
    await prisma.membership.delete({ where: { id: m.id } })
    expect((await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token })))).status).toBe(401)
  })

  test('vínculo de outra conta com o bid da conta do cabeçalho: 401', async () => {
    const user = await makeUser()
    const deB = await makeMembership(b.id, user.id, 'OWNER')
    const r = await callRoute(daEquipe, apiRequest('GET', '/v1/teste/equipe', comConta({ token: await staffToken(a.id, deB.id, user.id) })))
    expect(r.status).toBe(401)
  })
})

describe('visitante ou token de cliente (guest_or_customer)', () => {
  const rota = '/v1/teste/visitante-ou-cliente'
  let cliente: Customer
  beforeEach(async () => {
    cliente = await makeCustomer(a.id)
  })

  test('sem Authorization: visitante; com token de cliente válido: o cliente', async () => {
    const visitante = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta()))
    expect(visitante.json).toEqual({ ator: 'guest', clienteId: null, canal: 'app' })
    const token = await customerToken(a.id, cliente.id)
    const logado = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta({ token })))
    expect(logado.json).toEqual({ ator: 'customer', clienteId: cliente.id, canal: 'app' })
  })

  test('token presente e ruim nunca vira visitante: inválido, vencido, vazio e não Bearer dão 401', async () => {
    const vencido = (await signAccessToken({ kind: 'customer', businessId: a.id, customerId: cliente.id }, addMinutes(new Date(), -60))).token
    for (const o of [{ token: 'lixo' }, { token: vencido }, { headers: { authorization: '' } }, { headers: { authorization: 'Basic abc' } }]) {
      const r = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta(o)))
      expect(r.status, JSON.stringify(o).slice(0, 40)).toBe(401)
      expect(apiError(r.json).reason).toBe('session_invalid')
    }
    expect(chamadas).toBe(0)
  })

  test('token de equipe: 403; de cliente de outra conta ou arquivado: 401', async () => {
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const equipe = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta({ token: await staffToken(a.id, m.id, user.id) })))
    expect(equipe.status).toBe(403)
    expect(apiError(equipe.json).reason).toBe('wrong_token_kind')
    const deB = await makeCustomer(b.id)
    const cruzado = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta({ token: await customerToken(b.id, deB.id) })))
    expect(cruzado.status).toBe(401)
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: new Date() } })
    const arquivado = await callRoute(visitanteOuCliente, apiRequest('GET', rota, comConta({ token: await customerToken(a.id, cliente.id) })))
    expect(arquivado.status).toBe(401)
    expect(chamadas).toBe(0)
  })
})

describe('limite por sujeito e status escolhido pelo handler', () => {
  test('limitBy subject: conta por cliente, qualquer que seja o IP', async () => {
    const um = await makeCustomer(a.id)
    const dois = await makeCustomer(a.id)
    const t1 = await customerToken(a.id, um.id)
    const t2 = await customerToken(a.id, dois.id)
    const chamar = (token: string, ip: string) =>
      callRoute(limitadaPorSujeito, apiRequest('POST', '/v1/teste/limitada-por-sujeito', comConta({ token, headers: { 'x-forwarded-for': ip } })))
    expect((await chamar(t1, '198.51.100.1')).status).toBe(200)
    expect((await chamar(t1, '198.51.100.2')).status).toBe(200)
    const barrada = await chamar(t1, '198.51.100.3')
    expect(barrada.status).toBe(429)
    expect(barrada.headers.get('retry-after')).not.toBeNull()
    expect((await chamar(t2, '198.51.100.1')).status).toBe(200)
    expect(chamadas).toBe(3)
  })

  test('token inválido em rota com limite por sujeito: 401, sem chegar ao handler', async () => {
    const r = await callRoute(limitadaPorSujeito, apiRequest('POST', '/v1/teste/limitada-por-sujeito', comConta({ token: 'lixo' })))
    expect(r.status).toBe(401)
    expect(chamadas).toBe(0)
  })

  test('setStatus só aceita status declarado em status ou alternateStatuses: outro é erro de programação (500)', async () => {
    const r = await callRoute(statusNaoDeclarado, apiRequest('POST', '/v1/teste/status-nao-declarado', comConta()))
    expect(r.status).toBe(500)
    expect(statusDinamico.definition.alternateStatuses).toEqual([200])
  })

  test('setStatus troca o status de sucesso da rota (201 padrão, 200 quando o handler pede)', async () => {
    const novo = await callRoute(statusDinamico, apiRequest('POST', '/v1/teste/status-dinamico', comConta({ body: { repetido: false } })))
    expect(novo.status).toBe(201)
    const repetido = await callRoute(statusDinamico, apiRequest('POST', '/v1/teste/status-dinamico', comConta({ body: { repetido: true } })))
    expect(repetido.status).toBe(200)
    expect(repetido.json).toEqual({ ok: true })
  })
})

describe('corpo, parâmetros e consulta', () => {
  const post = (body?: unknown, extra: Parameters<typeof apiRequest>[2] = {}) =>
    callRoute(eco, apiRequest('POST', '/v1/teste/eco', comConta({ ...(body === undefined ? {} : { body }), ...extra })))

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
    expect(chamadas).toBe(0)
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
    const sem = await callRoute(eco, new Request('http://api.localhost:3000/v1/teste/eco', { method: 'POST', headers: { 'x-business': a.slug }, body: '{"nome":"x","qtd":1}' }))
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
      headers: { 'x-business': a.slug, 'content-type': 'application/json' },
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
      headers: { 'x-business': a.slug, 'content-type': 'application/json' },
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
    const r = await callRoute(apagada, apiRequest('DELETE', '/v1/teste/apagada', comConta({ body: 'lixo {', headers: { 'content-type': 'text/plain' } })))
    expect(r.status).toBe(204)
  })

  test('params e query: coerção pelo esquema da rota; id inválido e consulta desconhecida são 422', async () => {
    const id = crypto.randomUUID()
    const ok = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?n=3`, comConta()), { id })
    expect(ok.status).toBe(200)
    expect(ok.json).toEqual({ id, n: 3, tags: null })
    const padrao = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}`, comConta()), { id })
    expect(jsonObject(padrao.json).n).toBe(1)
    const repetida = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?tags=a&tags=b`, comConta()), { id })
    expect(jsonObject(repetida.json).tags).toEqual(['a', 'b'])
    const ruim = await callRoute(comParametros, apiRequest('GET', '/v1/teste/itens/xyz', comConta()), { id: 'xyz' })
    expect(ruim.status).toBe(422)
    expect(Object.keys(apiError(ruim.json).fields ?? {})).toEqual(['id'])
    const desconhecida = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?x=1`, comConta()), { id })
    expect(desconhecida.status).toBe(422)
    expect(Object.keys(apiError(desconhecida.json).fields ?? {})).toEqual(['x'])
    const tipo = await callRoute(comParametros, apiRequest('GET', `/v1/teste/itens/${id}?n=abc`, comConta()), { id })
    expect(tipo.status).toBe(422)
    expect(Object.keys(apiError(tipo.json).fields ?? {})).toEqual(['n'])
  })
})

describe('erros e resposta', () => {
  test('erro inesperado: 500 internal sem a mensagem original; o log leva o id da requisição e a rota, sem segredos', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const token = 'token-que-nao-deve-vazar'
      const r = await callRoute(explode, apiRequest('GET', '/v1/teste/explode', comConta({ token, headers: { 'x-outro': 'senha=abc' } })))
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
      expect(gravado).not.toContain(token)
      expect(gravado).not.toContain('senha=abc')
    } finally {
      log.mockRestore()
    }
  })

  test('cada resposta traz um X-Request-Id diferente', async () => {
    const r1 = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    const r2 = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(r1.headers.get('x-request-id')).not.toBe(r2.headers.get('x-request-id'))
  })

  test('DomainError de conflito: 409 com reason e details serializados (datas em ISO)', async () => {
    const r = await callRoute(conflito, apiRequest('GET', '/v1/teste/conflito', comConta()))
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toEqual({
      code: 'conflict',
      reason: 'slot_taken',
      message: 'Este horário já foi ocupado. Escolha outro.',
      details: { startsAt: '2027-01-15T08:00:00.000Z' },
    })
  })

  test('sucesso com Date, bigint e undefined sai como JSON puro em ISO UTC', async () => {
    const r = await callRoute(comDatas, apiRequest('GET', '/v1/teste/datas', comConta()))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ quando: '2027-01-15T08:00:00.000Z', grande: 7, lista: ['2027-01-15T08:00:00.000Z'] })
  })

  test('resposta fora do contrato vira 500 em teste (erro de programação)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const r = await callRoute(foraDoContrato, apiRequest('GET', '/v1/teste/fora-do-contrato', comConta()))
      expect(r.status).toBe(500)
      expect(apiError(r.json).code).toBe('internal')
    } finally {
      log.mockRestore()
    }
  })

  test('status 201 devolve o corpo; 204 não tem corpo nem Content-Type de JSON', async () => {
    const c = await callRoute(criada, apiRequest('POST', '/v1/teste/criada', comConta({ body: { nome: 'x' } })))
    expect(c.status).toBe(201)
    expect(c.json).toEqual({ nome: 'x' })
    const d = await callRoute(apagada, apiRequest('DELETE', '/v1/teste/apagada', comConta()))
    expect(d.status).toBe(204)
    expect(d.text).toBe('')
    expect(d.headers.get('cache-control')).toBe('no-store')
  })
})

describe('limites de requisições', () => {
  test('a 121ª requisição no minuto do mesmo IP é 429 com Retry-After inteiro', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
      if (r.status !== 200) throw new Error(`requisição ${i + 1} deu ${r.status}`)
    }
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta()))
    expect(r.status).toBe(429)
    expect(apiError(r.json).code).toBe('rate_limited')
    const espera = Number(r.headers.get('retry-after'))
    expect(Number.isInteger(espera)).toBe(true)
    expect(espera).toBeGreaterThanOrEqual(1)
    expect(espera).toBeLessThanOrEqual(60)
    // O limite geral é por IP, não por conta: outra conta no mesmo IP também é barrada; outro IP não.
    const outraConta = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: b.slug }))
    expect(outraConta.status).toBe(429)
    const outroIp = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ headers: { 'x-forwarded-for': '203.0.113.20' } })))
    expect(outroIp.status).toBe(200)
  }, 60_000)

  test('o limite geral vale antes de procurar a conta: X-Business desconhecido também conta', async () => {
    const doIp = { 'x-forwarded-for': '203.0.113.7' }
    for (let i = 0; i < 120; i++) {
      const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: 'nao-existe', headers: doIp }))
      if (r.status !== 401) throw new Error(`tentativa ${i + 1} deu ${r.status}`)
    }
    const barrada = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', { business: 'nao-existe', headers: doIp }))
    expect(barrada.status).toBe(429)
    expect(Number(barrada.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    const valida = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ headers: doIp })))
    expect(valida.status).toBe(429)
  }, 60_000)

  test('limite da rota vale além do geral e é por rota e por IP', async () => {
    const pedir = (ip: string) => callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comConta({ headers: { 'x-forwarded-for': ip } })))
    expect((await pedir('198.51.100.1')).status).toBe(200)
    expect((await pedir('198.51.100.1')).status).toBe(200)
    const barrada = await pedir('198.51.100.1')
    expect(barrada.status).toBe(429)
    expect(Number(barrada.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    // Outras rotas do mesmo IP seguem.
    const outraRota = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta', comConta({ headers: { 'x-forwarded-for': '198.51.100.1' } })))
    expect(outraRota.status).toBe(200)
    expect((await pedir('198.51.100.2')).status).toBe(200)
  })

  test("rota auth 'none' com limit devolve 429 depois do teto por IP; outro IP segue; sem limit, nada é contado", async () => {
    const pedir = (ip: string) => callRoute(publicaLimitada, apiRequest('POST', '/v1/teste/publica-limitada', { headers: { 'x-forwarded-for': ip } }))
    expect((await pedir('198.51.100.9')).status).toBe(200)
    expect((await pedir('198.51.100.9')).status).toBe(200)
    const barrada = await pedir('198.51.100.9')
    expect(barrada.status).toBe(429)
    expect(apiError(barrada.json).code).toBe('rate_limited')
    expect(Number(barrada.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(chamadas).toBe(2)
    expect((await pedir('198.51.100.10')).status).toBe(200)
    const linhas = await prisma.rateLimitBucket.findMany()
    expect(linhas.some((l) => l.key.startsWith('api:'))).toBe(true)
    expect(linhas.some((l) => l.key.startsWith('api-rota:POST /v1/teste/publica-limitada:'))).toBe(true)
    await callRoute(publica, apiRequest('GET', '/v1/teste/publica', { headers: { 'x-forwarded-for': '198.51.100.99' } }))
    expect((await prisma.rateLimitBucket.findMany()).some((l) => l.key.includes('198.51.100.99'))).toBe(false)
  })

  test('requisição barrada pelo limite não chega ao handler', async () => {
    for (let i = 0; i < 2; i++) expect((await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comConta()))).status).toBe(200)
    expect(chamadas).toBe(2)
    for (let i = 0; i < 3; i++) expect((await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comConta()))).status).toBe(429)
    expect(chamadas).toBe(2)
  })

  test('as chaves de limite guardadas são por IP e rota, sem prefixo de chave nem token', async () => {
    const token = await customerToken(a.id, (await makeCustomer(a.id)).id)
    await callRoute(limitada, apiRequest('GET', '/v1/teste/limitada', comConta({ token })))
    const linhas = await prisma.rateLimitBucket.findMany()
    expect(linhas.length).toBeGreaterThanOrEqual(2)
    for (const l of linhas) expect(l.key).not.toContain(token)
    expect(linhas.some((l) => l.key === 'api:sem-ip')).toBe(true)
    expect(linhas.some((l) => l.key.startsWith('api-rota:GET /v1/teste/limitada:'))).toBe(true)
  })
})

describe('definição anexada ao handler', () => {
  test('o handler carrega a definição da rota (método, caminho, autenticação)', () => {
    expect(porConta.definition).toMatchObject({ method: 'GET', path: '/v1/teste/conta' })
    expect(statusDinamico.definition).toMatchObject({ method: 'POST', path: '/v1/teste/status-dinamico' })
  })
})

describe('corpo opcional e cache', () => {
  const opcional = defineRoute({
    method: 'POST',
    path: '/v1/teste/corpo-opcional',
    auth: 'guest',
    summary: 'Corpo opcional',
    tag: 'teste',
    bodyOptional: true,
    body: z.object({ motivo: z.string().optional() }),
    response: z.object({ motivo: z.string().nullable() }),
    handler: async ({ body }) => ({ motivo: body.motivo ?? null }),
  })

  test('sem corpo vira {}; com corpo válido vale; JSON ruim, tipo errado e campo desconhecido seguem 422', async () => {
    const sem = await callRoute(opcional, apiRequest('POST', '/v1/teste/corpo-opcional', comConta()))
    expect(sem.status).toBe(200)
    expect(sem.json).toEqual({ motivo: null })
    const com = await callRoute(opcional, apiRequest('POST', '/v1/teste/corpo-opcional', comConta({ body: { motivo: 'x' } })))
    expect(com.json).toEqual({ motivo: 'x' })
    expect((await callRoute(opcional, apiRequest('POST', '/v1/teste/corpo-opcional', comConta({ body: '{ruim' })))).status).toBe(422)
    expect((await callRoute(opcional, apiRequest('POST', '/v1/teste/corpo-opcional', comConta({ body: { outro: 1 } })))).status).toBe(422)
    expect((await callRoute(opcional, apiRequest('POST', '/v1/teste/corpo-opcional', comConta({ body: 'texto', headers: { 'content-type': 'text/plain' } })))).status).toBe(422)
  })

  test('sem a opção, corpo ausente continua 422', async () => {
    const r = await callRoute(eco, apiRequest('POST', '/v1/teste/eco', comConta()))
    expect(r.status).toBe(422)
  })

  test('cache só em rota sem autenticação: com conta ou token é erro de programação ao definir', () => {
    const base = { method: 'GET', path: '/v1/teste/cache', summary: 'Cache', tag: 'teste', cache: { maxAgeSec: 60 }, response: z.object({}), handler: async () => ({}) }
    for (const auth of ['guest', 'guest_or_customer', 'customer', 'staff']) {
      expect(() => defineRoute({ ...base, auth } as unknown as Parameters<typeof defineRoute>[0]), auth).toThrow(/cache/)
    }
    expect(() => defineRoute({ ...base, auth: 'none' } as unknown as Parameters<typeof defineRoute>[0])).not.toThrow()
  })
})

describe('contrato da resposta (formato de fio)', () => {
  test('campo a mais na raiz é erro de programação (500) fora de produção, apontando o caminho no log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const r = await callRoute(campoExtra, apiRequest('GET', '/v1/teste/campo-extra', comConta()))
      expect(r.status).toBe(500)
      expect(r.text).not.toContain('vazou')
      expect(log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('vazou')
    } finally {
      log.mockRestore()
    }
  })

  test('campo a mais em objeto dentro de lista também: o caminho aparece no log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const r = await callRoute(campoExtraAninhado, apiRequest('GET', '/v1/teste/campo-extra-aninhado', comConta()))
      expect(r.status).toBe(500)
      expect(r.text).not.toContain('senha')
      expect(log.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('itens.1.senha')
    } finally {
      log.mockRestore()
    }
  })

  test('handler devolve Date com esquema isoInstant: 200 com ISO UTC', async () => {
    const r = await callRoute(comDataIso, apiRequest('GET', '/v1/teste/data-iso', comConta()))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ quando: '2027-01-15T08:00:00.000Z' })
  })

  test('o esquema de resposta das rotas vira JSON Schema (teste e health)', () => {
    for (const handler of [comDataIso, comDatas, healthGet]) {
      const js = z.toJSONSchema(handler.definition.response)
      expect(js.type).toBe('object')
    }
  })
})

describe('defesas da camada', () => {
  test('DomainError com details que não serializa: 500 internal padrão, com X-Request-Id e CORS', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const r = await callRoute(detalhesImpossiveis, apiRequest('GET', '/v1/teste/detalhes-impossiveis', comConta({ origin: ORIGEM })))
      expect(r.status).toBe(500)
      expect(apiError(r.json).code).toBe('internal')
      expect(r.headers.get('x-request-id')).toBeTruthy()
      expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  test('rota sem esquema de consulta recusa parâmetro de consulta com o nome dele; consulta vazia passa', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta?debug=1', comConta()))
    expect(r.status).toBe(422)
    expect(Object.keys(apiError(r.json).fields ?? {})).toEqual(['debug'])
    expect(chamadas).toBe(0)
    expect((await callRoute(porConta, apiRequest('GET', '/v1/teste/conta?', comConta()))).status).toBe(200)
    expect((await callRoute(healthGet, apiRequest('GET', '/v1/health?'))).status).toBe(200)
    expect((await callRoute(publica, apiRequest('GET', '/v1/teste/publica?x=1'))).status).toBe(422)
  })

  test('?__proto__=x numa rota sem esquema de consulta é 422, com o nome do parâmetro', async () => {
    const r = await callRoute(porConta, apiRequest('GET', '/v1/teste/conta?__proto__=x', comConta()))
    expect(r.status).toBe(422)
    expect(Object.keys(apiError(r.json).fields ?? {})).toEqual(['__proto__'])
    expect(chamadas).toBe(0)
  })
})
