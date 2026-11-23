import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as obterOpenApi } from '@/app/api/v1/openapi.json/route'
import { GET as agenda } from '@/app/api/v1/staff/agenda/route'
import { GET as availability } from '@/app/api/v1/availability/route'
import { GET as business } from '@/app/api/v1/business/route'
import { POST as marcar } from '@/app/api/v1/appointments/route'
import { buildOpenApi } from '@/server/api/openapi'
import { ROUTE_MODULES, routeDefinitions } from '@/server/api/routes-manifest'
import { preflight } from '@/server/api/define-route'
import { API_ERROR_CODES } from '@/server/api/errors'
import { CAPABILITIES } from '@/server/auth/capabilities'
import { env } from '@/server/env'
import { API_REASONS, DOMAIN_REASONS } from '@/server/domain/errors'
import { apiRequest, callRoute, jsonObject, staffToken } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeMembership, makeUser } from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

const RAIZ = process.cwd()
const PASTA_V1 = join(RAIZ, 'src/app/api/v1')
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type Json = Record<string, unknown>
type Doc = Json & { paths: Record<string, Record<string, Json>>; components: Json }

const objeto = (v: unknown): Json => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`Esperava um objeto, veio ${JSON.stringify(v)?.slice(0, 80)}`)
  return v as Json
}

/** Rotas simples, que não são do app e ficam fora do manifesto e do documento OpenAPI (webhook do Mercado Pago). */
const ROTAS_FORA_DO_OPENAPI = ['webhooks/mercadopago/[webhookKey]/route.ts']

/** Arquivos `route.ts` sob `src/app/api/v1`, relativos a ela, sem as exceções declaradas. */
function arquivosDeRota(): string[] {
  return (readdirSync(PASTA_V1, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /(^|\/)route\.(ts|tsx|js)$/.test(f) && !ROTAS_FORA_DO_OPENAPI.includes(f))
    .sort()
}

const caminhoDoArquivo = (arquivo: string): string =>
  `/v1/${arquivo.replace(/\/?route\.(ts|tsx|js)$/, '').replace(/\[([^\]]+)\]/g, '{$1}')}`.replace(/\/$/, '')

describe('manifesto de rotas', () => {
  test('lista exatamente os arquivos route.ts de src/app/api/v1', () => {
    expect(Object.keys(ROUTE_MODULES).sort()).toEqual(arquivosDeRota())
  })

  test('cada arquivo exporta OPTIONS = preflight e só handlers de defineRoute para os métodos', () => {
    for (const [arquivo, modulo] of Object.entries(ROUTE_MODULES)) {
      expect(modulo.OPTIONS, `${arquivo} sem OPTIONS = preflight`).toBe(preflight)
      const metodos = METODOS.filter((m) => modulo[m] !== undefined)
      expect(metodos.length, `${arquivo} sem método`).toBeGreaterThan(0)
      const extras = Object.keys(modulo).filter((nome) => nome !== 'OPTIONS' && !(METODOS as readonly string[]).includes(nome))
      expect(extras, `${arquivo} exporta algo que não é método`).toEqual([])
      for (const m of metodos) {
        const handler = modulo[m] as { definition?: { method: string; path: string } }
        expect(handler.definition, `${arquivo} ${m} não foi criado por defineRoute`).toBeDefined()
        expect(handler.definition?.method, arquivo).toBe(m)
        expect(handler.definition?.path, arquivo).toBe(caminhoDoArquivo(arquivo))
      }
    }
  })

  test('método mais caminho não se repetem e todos os métodos exportados estão nas definições', () => {
    const definicoes = routeDefinitions()
    const chaves = definicoes.map((d) => `${d.method} ${d.path}`)
    expect(new Set(chaves).size).toBe(chaves.length)
    const exportados = Object.values(ROUTE_MODULES).reduce((n, m) => n + METODOS.filter((x) => m[x] !== undefined).length, 0)
    expect(definicoes).toHaveLength(exportados)
  })

  test('a única exceção declarada é o webhook do Mercado Pago, e ele não aparece no documento', async () => {
    expect(ROTAS_FORA_DO_OPENAPI).toEqual(['webhooks/mercadopago/[webhookKey]/route.ts'])
    expect(readFileSync(join(PASTA_V1, ROTAS_FORA_DO_OPENAPI[0]!), 'utf8')).not.toContain('defineRoute')
    expect(Object.keys(ROUTE_MODULES).some((k) => k.startsWith('webhooks/'))).toBe(false)
  })

  test('a criação de pedido exige o cabeçalho Idempotency-Key e as outras rotas idempotentes o aceitam', () => {
    const cabecalho = (def: { method: string; path: string }) => ((routeDefinitions().find((d) => d.method === def.method && d.path === def.path)) as { idempotent?: unknown } | undefined)?.idempotent
    expect(cabecalho({ method: 'POST', path: '/v1/store/orders' })).toBe('required')
    expect(cabecalho({ method: 'POST', path: '/v1/appointments' })).toBe(true)
  })

  test('os arquivos novos de rota não escapam: cada route.ts tem import no manifesto', () => {
    const texto = readFileSync(join(RAIZ, 'src/server/api/routes-manifest.ts'), 'utf8')
    for (const arquivo of arquivosDeRota()) {
      const alvo = `@/app/api/v1/${arquivo.replace(/\.(ts|tsx|js)$/, '')}`
      expect(texto, arquivo).toContain(`'${alvo}'`)
    }
  })
})

describe('lista de códigos de voucher do cliente', () => {
  test('o documento descreve cursor, limit e nextCursor', () => {
    const doc = buildOpenApi() as unknown as Doc
    const op = objeto(objeto(doc.paths['/v1/me/voucher-codes'])['get'])
    const nomes = (op.parameters as { name: string }[]).map((p) => p.name)
    expect(nomes).toEqual(expect.arrayContaining(['cursor', 'limit']))
    expect(JSON.stringify(op.responses)).toContain('nextCursor')
  })
})

describe('rotas de módulo', () => {
  const PREFIXOS = ['/v1/loyalty', '/v1/banners', '/v1/store', '/v1/vouchers', '/v1/me/addresses', '/v1/me/voucher-codes']

  test('cada rota declara o módulo do seu prefixo', () => {
    const DO_PREFIXO: Record<string, string> = {
      '/v1/loyalty': 'loyalty',
      '/v1/banners': 'banners',
      '/v1/store': 'store',
      '/v1/vouchers': 'vouchers',
      '/v1/me/addresses': 'store',
      '/v1/me/voucher-codes': 'vouchers',
    }
    for (const def of routeDefinitions()) {
      for (const [prefixo, modulo] of Object.entries(DO_PREFIXO)) {
        if (def.path === prefixo || def.path.startsWith(`${prefixo}/`)) expect(def.module, `${def.method} ${def.path}`).toBe(modulo)
      }
    }
  })

  test('toda rota de módulo declara `module` (e só elas, com um módulo conhecido)', () => {
    for (const def of routeDefinitions()) {
      const doModulo = PREFIXOS.some((p) => def.path === p || def.path.startsWith(`${p}/`))
      if (doModulo) expect(def.module, `${def.method} ${def.path} sem module`).toBeDefined()
    }
  })

  test('a descrição da operação diz qual módulo a rota exige', () => {
    for (const def of routeDefinitions()) {
      if (def.module === undefined) continue
      const op = objeto(objeto(objeto(buildOpenApi().paths)[def.path])[def.method.toLowerCase()])
      expect(String(op.description)).toContain('Exige o módulo')
    }
  })

  test('o 404 documentado diz que `error.code` (e não `error.reason`) é module_disabled', () => {
    const texto = JSON.stringify(objeto(buildOpenApi().components).responses)
    expect(texto).toContain('o módulo da rota está desligado: `error.code` é `module_disabled`')
    expect(texto).not.toContain('`error.reason` é `module_disabled`')
  })
})

describe('motivos e códigos de erro', () => {
  test('a lista de motivos da API não repete os do domínio e está ordenada', () => {
    expect(API_REASONS.filter((r) => (DOMAIN_REASONS as readonly string[]).includes(r))).toEqual([])
    expect([...API_REASONS]).toEqual([...API_REASONS].sort())
    expect(new Set(API_REASONS).size).toBe(API_REASONS.length)
  })

  test('todo motivo lançado como texto no código está na lista', () => {
    const achados: string[] = []
    const varre = (pasta: string): void => {
      for (const e of readdirSync(pasta, { withFileTypes: true })) {
        const caminho = join(pasta, e.name)
        if (e.isDirectory()) varre(caminho)
        else if (/\.tsx?$/.test(e.name)) {
          const texto = readFileSync(caminho, 'utf8')
          for (const m of texto.matchAll(/new ApiAuthError\(\s*'[a-z_]+',\s*'([a-z_]+)'/g)) achados.push(m[1] ?? '')
        }
      }
    }
    varre(join(RAIZ, 'src'))
    const erros = readFileSync(join(RAIZ, 'src/server/api/errors.ts'), 'utf8')
    for (const m of erros.matchAll(/reason: '([a-z_]+)'/g)) achados.push(m[1] ?? '')
    expect(achados.length).toBeGreaterThan(5)
    for (const motivo of achados) expect(API_REASONS as readonly string[], motivo).toContain(motivo)
  })
})

/** Resolve `#/a/b` dentro do documento. */
function resolve(doc: Json, ref: string): Json {
  if (!ref.startsWith('#/')) throw new Error(`$ref fora do documento: ${ref}`)
  let atual: unknown = doc
  for (const parte of ref.slice(2).split('/')) atual = objeto(atual)[parte.replace(/~1/g, '/').replace(/~0/g, '~')]
  return objeto(atual)
}

function referencias(valor: unknown, achadas: string[] = []): string[] {
  if (Array.isArray(valor)) valor.forEach((v) => referencias(v, achadas))
  else if (typeof valor === 'object' && valor !== null) {
    for (const [k, v] of Object.entries(valor)) {
      if (k === '$ref' && typeof v === 'string') achadas.push(v)
      else referencias(v, achadas)
    }
  }
  return achadas
}

/** Checagem estrutural mínima de OpenAPI 3.1: campos obrigatórios e `$ref` resolvidos. Devolve os problemas. */
function problemasDoDocumento(doc: Json): string[] {
  const p: string[] = []
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.1')) p.push('openapi deve ser 3.1.x')
  const info = objeto(doc.info)
  if (typeof info.title !== 'string' || typeof info.version !== 'string') p.push('info.title e info.version são obrigatórios')
  if (!Array.isArray(doc.servers) || doc.servers.length === 0) p.push('servers vazio')
  const caminhos = objeto(doc.paths)
  if (Object.keys(caminhos).length === 0) p.push('paths vazio')
  const esquemas = Object.keys(objeto(objeto(doc.components).securitySchemes))
  const ids = new Set<string>()
  for (const [caminho, item] of Object.entries(caminhos)) {
    if (!caminho.startsWith('/')) p.push(`caminho sem barra: ${caminho}`)
    const nomesNoCaminho = [...caminho.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
    for (const [metodo, op] of Object.entries(objeto(item))) {
      const onde = `${metodo.toUpperCase()} ${caminho}`
      const o = objeto(op)
      if (typeof o.operationId !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(o.operationId)) p.push(`${onde}: operationId inválido`)
      else if (ids.has(o.operationId)) p.push(`${onde}: operationId repetido`)
      else ids.add(o.operationId)
      if (typeof o.summary !== 'string' || o.summary.trim() === '') p.push(`${onde}: sem resumo`)
      if (!Array.isArray(o.tags) || o.tags.length === 0) p.push(`${onde}: sem tags`)
      const responses = objeto(o.responses)
      if (!Object.keys(responses).some((s) => /^2\d\d$/.test(s))) p.push(`${onde}: sem resposta 2xx`)
      const parametros = (Array.isArray(o.parameters) ? o.parameters : []).map(objeto)
      const doCaminho = parametros.filter((x) => x.in === 'path').map((x) => x.name)
      if ([...doCaminho].sort().join() !== nomesNoCaminho.sort().join()) p.push(`${onde}: parâmetros de caminho não batem`)
      for (const exigencia of Array.isArray(o.security) ? o.security : []) {
        for (const nome of Object.keys(objeto(exigencia))) if (!esquemas.includes(nome)) p.push(`${onde}: esquema de segurança desconhecido ${nome}`)
      }
    }
  }
  for (const ref of referencias(doc)) {
    try {
      resolve(doc, ref)
    } catch {
      p.push(`$ref não resolvido: ${ref}`)
    }
  }
  return p
}

/** Validador mínimo de JSON Schema (2020-12) para o que o Zod gera: tipos, enum, const, objetos, listas, anyOf, formatos e limites. */
const IMPLEMENTADAS = new Set([
  '$ref', 'type', 'const', 'enum', 'anyOf', 'pattern', 'format', 'minLength', 'maxLength', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'items', 'properties', 'required',
  'additionalProperties', 'propertyNames',
])
const ANOTACOES = new Set(['description', 'default', 'title', '$schema', 'examples', 'deprecated'])
const FORMATOS: Record<string, RegExp> = {
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
}

function validar(schema: Json, valor: unknown, doc: Json, caminho = '$'): string[] {
  // Palavra-chave que o validador não implementa é erro: nunca finge que validou.
  for (const chave of Object.keys(schema)) {
    if (!IMPLEMENTADAS.has(chave) && !ANOTACOES.has(chave)) throw new Error(`O validador de contrato não implementa a palavra-chave "${chave}" (${caminho}).`)
  }
  if (typeof schema.$ref === 'string') return validar(resolve(doc, schema.$ref), valor, doc, caminho)
  const erros: string[] = []
  const tipoDe = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
  if (schema.type !== undefined) {
    const aceitos = Array.isArray(schema.type) ? schema.type : [schema.type]
    const t = tipoDe(valor)
    if (!aceitos.includes(t) && !(t === 'integer' && aceitos.includes('number'))) return [`${caminho}: tipo ${t}, esperava ${aceitos.join('|')}`]
  }
  if (schema.const !== undefined && schema.const !== valor) erros.push(`${caminho}: valor diferente de ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.includes(valor)) erros.push(`${caminho}: ${JSON.stringify(valor)} fora do enum`)
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((s) => validar(objeto(s), valor, doc, caminho).length === 0)) {
    erros.push(`${caminho}: nenhum ramo de anyOf aceita ${JSON.stringify(valor)?.slice(0, 60)}`)
  }
  if (typeof valor === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(valor)) erros.push(`${caminho}: "${valor}" não casa com o padrão`)
    if (typeof schema.format === 'string') {
      const formato = FORMATOS[schema.format]
      if (!formato) throw new Error(`O validador de contrato não implementa o formato "${schema.format}" (${caminho}).`)
      if (!formato.test(valor)) erros.push(`${caminho}: "${valor}" não é ${schema.format}`)
    }
    if (typeof schema.minLength === 'number' && valor.length < schema.minLength) erros.push(`${caminho}: curto demais`)
    if (typeof schema.maxLength === 'number' && valor.length > schema.maxLength) erros.push(`${caminho}: longo demais`)
  }
  if (typeof valor === 'number') {
    if (typeof schema.minimum === 'number' && valor < schema.minimum) erros.push(`${caminho}: abaixo do mínimo`)
    if (typeof schema.maximum === 'number' && valor > schema.maximum) erros.push(`${caminho}: acima do máximo`)
    if (typeof schema.exclusiveMinimum === 'number' && valor <= schema.exclusiveMinimum) erros.push(`${caminho}: não passa do mínimo exclusivo`)
    if (typeof schema.exclusiveMaximum === 'number' && valor >= schema.exclusiveMaximum) erros.push(`${caminho}: não fica abaixo do máximo exclusivo`)
    if (typeof schema.multipleOf === 'number' && valor % schema.multipleOf !== 0) erros.push(`${caminho}: não é múltiplo de ${schema.multipleOf}`)
  }
  if (Array.isArray(valor)) {
    if (typeof schema.minItems === 'number' && valor.length < schema.minItems) erros.push(`${caminho}: poucos itens`)
    if (typeof schema.maxItems === 'number' && valor.length > schema.maxItems) erros.push(`${caminho}: itens demais`)
  }
  if (Array.isArray(valor) && schema.items !== undefined) {
    valor.forEach((item, i) => erros.push(...validar(objeto(schema.items), item, doc, `${caminho}[${i}]`)))
  }
  if (typeof valor === 'object' && valor !== null && !Array.isArray(valor)) {
    const props = schema.properties === undefined ? {} : objeto(schema.properties)
    for (const nome of Array.isArray(schema.required) ? schema.required : []) {
      if (!(nome in valor)) erros.push(`${caminho}: falta a chave obrigatória "${String(nome)}"`)
    }
    for (const [nome, item] of Object.entries(valor)) {
      if (schema.propertyNames !== undefined) erros.push(...validar(objeto(schema.propertyNames), nome, doc, `${caminho}.<chave ${nome}>`))
      if (nome in props) erros.push(...validar(objeto(props[nome]), item, doc, `${caminho}.${nome}`))
      else if (schema.additionalProperties === false) erros.push(`${caminho}: chave fora do contrato "${nome}"`)
      else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        erros.push(...validar(objeto(schema.additionalProperties), item, doc, `${caminho}.${nome}`))
      }
    }
  }
  return erros
}

/** Esquema JSON da resposta `status` da operação. */
function esquemaDaResposta(doc: Doc, metodo: string, caminho: string, status: number): Json {
  const resposta = objeto(objeto(doc.paths[caminho]?.[metodo.toLowerCase()]).responses)[String(status)]
  return objeto(objeto(objeto(objeto(resposta).content)['application/json']).schema)
}

let doc: Doc

beforeEach(() => {
  doc = buildOpenApi() as Doc
})

describe('documento OpenAPI', () => {
  test('é um OpenAPI 3.1 estruturalmente válido, com todos os $ref resolvidos', () => {
    expect(problemasDoDocumento(doc)).toEqual([])
  })

  test('o contrato de staff/me declara as capacidades como enum fechado, com as dos módulos', () => {
    const esquema = esquemaDaResposta(doc, 'get', '/v1/staff/me', 200)
    const itens = objeto(objeto(objeto(esquema.properties).capabilities).items)
    expect(itens.enum).toEqual([...CAPABILITIES])
    expect(itens.enum).toEqual(expect.arrayContaining(['manage_loyalty', 'manage_banners', 'manage_store', 'manage_vouchers']))
  })

  test('uma operação para cada método de cada rota, com operationId estável derivado de método e caminho', () => {
    const esperadas = routeDefinitions().map((d) => `${d.method} ${d.path}`).sort()
    const noDocumento = Object.entries(doc.paths).flatMap(([caminho, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${caminho}`)).sort()
    expect(noDocumento).toEqual(esperadas)
    const id = (m: string, c: string) => objeto(doc.paths[c]?.[m]).operationId
    expect(id('get', '/v1/health')).toBe('getHealth')
    expect(id('post', '/v1/appointments')).toBe('postAppointments')
    expect(id('post', '/v1/appointments/{id}/cancel')).toBe('postAppointmentsByIdCancel')
    expect(id('post', '/v1/staff/appointments/{id}/no-show')).toBe('postStaffAppointmentsByIdNoShow')
    expect(id('get', '/v1/openapi.json')).toBe('getOpenapiJson')
    expect(id('put', '/v1/staff/working-hours/{professionalId}')).toBe('putStaffWorkingHoursByProfessionalId')
  })

  test('toda operação tem resumo em português, tag e esquema de resposta (sem corpo só no 204)', () => {
    for (const def of routeDefinitions()) {
      const op = objeto(doc.paths[def.path]?.[def.method.toLowerCase()])
      expect(op.summary, `${def.method} ${def.path}`).toBe(def.summary)
      expect(op.tags, `${def.method} ${def.path}`).toEqual([def.tag])
      const sucesso = def.status ?? 200
      const resposta = objeto(objeto(op.responses)[String(sucesso)])
      if (sucesso === 204) expect(resposta.content).toBeUndefined()
      else expect(objeto(objeto(resposta.content)['application/json']).schema, `${def.method} ${def.path}`).toBeDefined()
      for (const alternativo of def.alternateStatuses ?? []) {
        expect(esquemaDaResposta(doc, def.method, def.path, alternativo)).toEqual(esquemaDaResposta(doc, def.method, def.path, sucesso))
      }
    }
  })

  test('segurança: só Bearer declarado (sem chave de app); rotas de cliente e de equipe pedem Bearer; as demais não pedem nada', () => {
    const esquemas = objeto(objeto(doc.components).securitySchemes)
    expect(Object.keys(esquemas)).toEqual(['Bearer'])
    expect(esquemas.Bearer).toMatchObject({ type: 'http', scheme: 'bearer' })
    expect(JSON.stringify(doc)).not.toMatch(/AppKey|X-App-Key/i)
    for (const def of routeDefinitions()) {
      const op = objeto(doc.paths[def.path]?.[def.method.toLowerCase()])
      const exigencias = (op.security as Json[]).map((s) => Object.keys(s))
      if (def.auth === 'customer' || def.auth === 'staff') expect(exigencias, def.path).toEqual([['Bearer']])
      if (def.auth === 'guest_or_customer') expect(exigencias, def.path).toEqual([[], ['Bearer']])
      if (def.auth === 'none' || def.auth === 'guest') expect(exigencias, def.path).toEqual([])
    }
  })

  test('X-Business é obrigatório nas rotas com conta e não existe nas rotas públicas', () => {
    for (const def of routeDefinitions()) {
      const op = objeto(doc.paths[def.path]?.[def.method.toLowerCase()])
      const cab = ((op.parameters ?? []) as Json[]).find((p) => p.name === 'X-Business')
      if (def.auth === 'none') expect(cab, def.path).toBeUndefined()
      else expect(cab, def.path).toMatchObject({ in: 'header', required: true })
    }
  })

  test('parâmetros: caminho e consulta com tipo e descrição de pelo menos um campo; cabeçalhos X-Business e Idempotency-Key onde valem', () => {
    const op = (m: string, c: string) => objeto(doc.paths[c]?.[m])
    const params = (m: string, c: string) => (op(m, c).parameters as Json[]).map((p) => `${String(p.in)}:${String(p.name)}`)
    expect(params('get', '/v1/staff/agenda')).toEqual(expect.arrayContaining(['query:from', 'query:to', 'query:professionalId', 'header:X-Business']))
    expect(params('post', '/v1/appointments')).toEqual(expect.arrayContaining(['header:Idempotency-Key', 'header:X-Business']))
    expect(params('post', '/v1/staff/appointments')).toContain('header:Idempotency-Key')
    expect(params('post', '/v1/appointments/{id}/cancel')).not.toContain('header:Idempotency-Key')
    expect(params('get', '/v1/health')).toEqual([])
    const chave = (m: string, c: string) => (op(m, c).parameters as Json[]).find((p) => p.name === 'Idempotency-Key')
    expect(chave('post', '/v1/store/orders')).toMatchObject({ in: 'header', required: true })
    expect(chave('post', '/v1/appointments')).toMatchObject({ in: 'header', required: false })
    const id = (op('get', '/v1/staff/customers/{id}').parameters as Json[]).find((p) => p.name === 'id')
    expect(id).toMatchObject({ in: 'path', required: true, schema: { type: 'string', format: 'uuid' } })
    const limit = (op('get', '/v1/appointments').parameters as Json[]).find((p) => p.name === 'limit')
    expect(limit).toMatchObject({ in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } })
    const semDescricao: string[] = []
    for (const [caminho, ops] of Object.entries(doc.paths)) {
      for (const [metodo, o] of Object.entries(ops)) {
        for (const p of (objeto(o).parameters ?? []) as Json[]) {
          if (String(p.description ?? '') === '') semDescricao.push(`${metodo} ${caminho} ${String(p.in)}:${String(p.name)}`)
        }
      }
    }
    expect(semDescricao).toEqual([])
  })

  test('corpo: o instante de entrada vira date-time com padrão e descrição; o corpo recusa chave desconhecida', () => {
    const corpo = objeto(objeto(objeto(objeto(doc.paths['/v1/appointments']?.post).requestBody).content)['application/json']).schema
    const schema = objeto(corpo)
    expect(schema.additionalProperties).toBe(false)
    expect(objeto(objeto(schema.properties).startsAt)).toMatchObject({ type: 'string', format: 'date-time' })
    expect(typeof objeto(objeto(schema.properties).startsAt).pattern).toBe('string')
    expect(String(objeto(objeto(schema.properties).startsAt).description)).toContain('Z')
    expect(schema.required).toEqual(expect.arrayContaining(['serviceIds', 'startsAt']))
  })

  test('respostas de erro: 413 com corpo, 404 em toda rota autenticada, 500 e 503 em todas', () => {
    for (const def of routeDefinitions()) {
      const respostas = objeto(objeto(doc.paths[def.path]?.[def.method.toLowerCase()]).responses)
      const onde = `${def.method} ${def.path}`
      expect(respostas['500'], onde).toBeDefined()
      expect(respostas['503'], onde).toBeDefined()
      if (def.auth !== 'none') expect(respostas['404'], onde).toBeDefined()
      if (def.body) expect(respostas['413'], onde).toBeDefined()
      else expect(respostas['413'], onde).toBeUndefined()
    }
  })

  test('datas locais têm format date e horas HH:mm têm padrão', () => {
    const parametros = (m: string, c: string) => objeto(doc.paths[c]?.[m]).parameters as Json[]
    const schemaDe = (lista: Json[], nome: string) => objeto(lista.find((p) => p.name === nome)?.schema)
    expect(schemaDe(parametros('get', '/v1/staff/agenda'), 'from')).toMatchObject({ format: 'date' })
    expect(schemaDe(parametros('get', '/v1/availability'), 'date')).toMatchObject({ format: 'date' })
    expect(schemaDe(parametros('get', '/v1/staff/time-blocks'), 'to')).toMatchObject({ format: 'date' })
    const corpo = objeto(objeto(objeto(objeto(doc.paths['/v1/staff/time-blocks']?.post).requestBody).content)['application/json']).schema
    const props = objeto(objeto(corpo).properties)
    expect(objeto(props.startDate)).toMatchObject({ format: 'date' })
    expect(objeto(props.endTime).pattern).toBe('^\\d{2}:\\d{2}$')
  })

  test('corpo opcional: requestBody.required é false só onde a rota declara bodyOptional', () => {
    const requerido = (m: string, c: string) => objeto(objeto(doc.paths[c]?.[m]).requestBody).required
    expect(requerido('post', '/v1/staff/appointments/{id}/cancel')).toBe(false)
    expect(requerido('post', '/v1/appointments')).toBe(true)
  })

  test('erros comuns referenciam o esquema de erro padrão, com a lista fechada de code e de reason', () => {
    const op = objeto(doc.paths['/v1/staff/time-blocks']?.post)
    const respostas = objeto(op.responses)
    for (const status of ['401', '403', '409', '422', '429']) {
      const ref = objeto(respostas[status]).$ref
      expect(typeof ref, status).toBe('string')
      const conteudo = objeto(objeto(resolve(doc, String(ref)).content)['application/json'])
      expect(objeto(conteudo.schema).$ref).toBe('#/components/schemas/ErrorResponse')
    }
    expect(objeto(objeto(doc.paths['/v1/staff/time-blocks/{id}']?.delete).responses)['404']).toBeDefined()
    expect(objeto(doc.paths['/v1/health']?.get).responses).not.toHaveProperty('401')
    const erro = objeto(objeto(objeto(objeto(objeto(doc.components).schemas).ErrorResponse).properties).error)
    const props = objeto(erro.properties)
    expect(objeto(props.code).enum).toEqual([...API_ERROR_CODES])
    expect(objeto(props.reason).enum).toEqual([...DOMAIN_REASONS, ...API_REASONS].sort())
    expect(erro.required).toEqual(['code', 'message'])
    expect(objeto(resolve(doc, '#/components/responses/TooManyRequests')).headers).toHaveProperty('Retry-After')
  })

  test('servidores vêm de API_HOST e nada interno vaza', () => {
    expect(doc.servers).toEqual([{ url: `http://${env.API_HOST}`, description: expect.any(String) }])
    const texto = JSON.stringify(doc)
    for (const proibido of ['/Users/', 'src/app', 'src/server', 'node_modules', 'process.env', 'DATABASE_URL', 'APP_SECRET', 'at Object.', 'route.ts']) {
      expect(texto, proibido).not.toContain(proibido)
    }
  })
})

describe('contrato: a resposta real segue o esquema do documento', () => {
  let c: Cena

  beforeEach(async () => {
    await resetDb()
    c = await montarCena()
  })

  const checar = (metodo: string, caminho: string, status: number, json: unknown) => {
    expect(validar(esquemaDaResposta(doc, metodo, caminho, status), json, doc)).toEqual([])
  }

  test('GET /v1/business', async () => {
    const r = await callRoute(business, apiRequest('GET', '/v1/business', { business: c.business.slug }))
    expect(r.status).toBe(200)
    checar('get', '/v1/business', 200, r.json)
  })

  test('GET /v1/availability', async () => {
    const r = await callRoute(availability, apiRequest('GET', `/v1/availability?date=${c.dia(10)}&serviceIds=${c.banho.id}`, { business: c.business.slug }))
    expect(r.status).toBe(200)
    expect((jsonObject(r.json).slots as unknown[]).length).toBeGreaterThan(0)
    checar('get', '/v1/availability', 200, r.json)
  })

  test('POST /v1/appointments (201)', async () => {
    const disp = await callRoute(availability, apiRequest('GET', `/v1/availability?date=${c.dia(10)}&serviceIds=${c.banho.id}&professionalId=${c.ana.id}`, { business: c.business.slug }))
    const slot = (jsonObject(disp.json).slots as { startsAt: string }[])[0]
    const r = await callRoute(
      marcar,
      apiRequest('POST', '/v1/appointments', { business: c.business.slug, token: c.tokenCliente, body: { serviceIds: [c.banho.id], professionalId: c.ana.id, startsAt: slot?.startsAt } }),
    )
    expect(r.status, r.text).toBe(201)
    checar('post', '/v1/appointments', 201, r.json)
  })

  test('GET /v1/staff/agenda (rota da equipe, com campos internos)', async () => {
    const user = await makeUser()
    const m = await makeMembership(c.business.id, user.id, 'OWNER')
    const token = await staffToken(c.business.id, m.id, user.id)
    const marcada = await callRoute(
      marcar,
      apiRequest('POST', '/v1/appointments', {
        business: c.business.slug,
        token: c.tokenCliente,
        body: {
          serviceIds: [c.banho.id],
          professionalId: c.ana.id,
          startsAt: (jsonObject((await callRoute(availability, apiRequest('GET', `/v1/availability?date=${c.dia(2)}&serviceIds=${c.banho.id}&professionalId=${c.ana.id}`, { business: c.business.slug }))).json).slots as { startsAt: string }[])[0]?.startsAt,
        },
      }),
    )
    expect(marcada.status, marcada.text).toBe(201)
    const r = await callRoute(agenda, apiRequest('GET', `/v1/staff/agenda?from=${c.dia(2)}&to=${c.dia(2)}`, { business: c.business.slug, token }))
    expect(r.status).toBe(200)
    const dias = jsonObject(r.json).days as { professionals: { appointments: unknown[] }[] }[]
    expect(dias[0]?.professionals.some((p) => p.appointments.length > 0)).toBe(true)
    checar('get', '/v1/staff/agenda', 200, r.json)
  })

  test('o validador de contrato reprova de verdade: chave a mais, tipo errado e chave faltando', async () => {
    const r = await callRoute(business, apiRequest('GET', '/v1/business', { business: c.business.slug }))
    const esquema = esquemaDaResposta(doc, 'get', '/v1/business', 200)
    const original = jsonObject(r.json)
    expect(validar(esquema, { ...original, interno: 1 }, doc)).not.toEqual([])
    expect(validar(esquema, { ...original, slug: 3 }, doc)).not.toEqual([])
    const semSlug = Object.fromEntries(Object.entries(original).filter(([chave]) => chave !== 'slug'))
    expect(validar(esquema, semSlug, doc)).not.toEqual([])
  })
})

describe('validador de contrato do próprio teste', () => {
  const vazio: Json = {}
  const casos: [string, Json, unknown, unknown][] = [
    ['type', { type: 'string' }, 1, 'a'],
    ['const', { const: 'a' }, 'b', 'a'],
    ['enum', { enum: ['a'] }, 'b', 'a'],
    ['anyOf', { anyOf: [{ type: 'string' }, { type: 'null' }] }, 1, null],
    ['pattern', { type: 'string', pattern: '^a$' }, 'b', 'a'],
    ['format date-time', { type: 'string', format: 'date-time' }, '2027-01-01', '2027-01-01T10:00:00.000Z'],
    ['format uuid', { type: 'string', format: 'uuid' }, 'x', '11111111-1111-4111-8111-111111111111'],
    ['format date', { type: 'string', format: 'date' }, '01/01/2027', '2027-01-01'],
    ['minLength', { type: 'string', minLength: 2 }, 'a', 'ab'],
    ['maxLength', { type: 'string', maxLength: 1 }, 'ab', 'a'],
    ['minimum', { type: 'number', minimum: 1 }, 0, 1],
    ['maximum', { type: 'number', maximum: 1 }, 2, 1],
    ['exclusiveMinimum', { type: 'number', exclusiveMinimum: 1 }, 1, 2],
    ['exclusiveMaximum', { type: 'number', exclusiveMaximum: 1 }, 1, 0],
    ['multipleOf', { type: 'number', multipleOf: 5 }, 3, 10],
    ['minItems', { type: 'array', minItems: 1 }, [], [1]],
    ['maxItems', { type: 'array', maxItems: 1 }, [1, 2], [1]],
    ['items', { type: 'array', items: { type: 'string' } }, [1], ['a']],
    ['properties e required', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, {}, { a: 'x' }],
    ['additionalProperties false', { type: 'object', additionalProperties: false }, { a: 1 }, {}],
    ['additionalProperties com esquema', { type: 'object', additionalProperties: { type: 'string' } }, { a: 1 }, { a: 'x' }],
    ['propertyNames', { type: 'object', propertyNames: { pattern: '^a' } }, { b: 1 }, { a: 1 }],
  ]
  test.each(casos)('%s: reprova o valor ruim e aceita o bom', (_nome, schema, ruim, bom) => {
    expect(validar(schema, ruim, vazio)).not.toEqual([])
    expect(validar(schema, bom, vazio)).toEqual([])
  })

  test('$ref é resolvido dentro do documento', () => {
    const d = { components: { schemas: { A: { type: 'string' } } } }
    expect(validar({ $ref: '#/components/schemas/A' }, 1, d)).not.toEqual([])
    expect(validar({ $ref: '#/components/schemas/A' }, 'x', d)).toEqual([])
  })

  test.each(['oneOf', 'allOf', 'not', 'patternProperties', 'uniqueItems', 'if', 'prefixItems', 'contains'])('palavra-chave não implementada (%s) lança erro', (palavra) => {
    expect(() => validar({ [palavra]: [] }, 1, vazio)).toThrow(/não implementa/)
  })

  test('formato desconhecido lança erro', () => {
    expect(() => validar({ type: 'string', format: 'email' }, 'a@b.c', vazio)).toThrow(/não implementa o formato/)
  })

  test('todos os esquemas de resposta do documento só usam palavras-chave que o validador conhece', () => {
    const percorre = (schema: Json, onde: string): void => {
      for (const chave of Object.keys(schema)) {
        expect(IMPLEMENTADAS.has(chave) || ANOTACOES.has(chave), `${onde}: ${chave}`).toBe(true)
      }
      for (const filho of Object.values(objeto(schema.properties ?? {}))) percorre(objeto(filho), onde)
      for (const ramo of Array.isArray(schema.anyOf) ? schema.anyOf : []) percorre(objeto(ramo), onde)
      for (const chave of ['items', 'propertyNames', 'additionalProperties'] as const) {
        const filho = schema[chave]
        if (typeof filho === 'object' && filho !== null) percorre(objeto(filho), onde)
      }
    }
    for (const def of routeDefinitions()) {
      const sucesso = def.status ?? 200
      if (sucesso !== 204) percorre(esquemaDaResposta(doc, def.method, def.path, sucesso), `${def.method} ${def.path}`)
    }
  })
})

describe('GET /v1/openapi.json', () => {
  test('responde sem conta, com cache público de 5 minutos, e o corpo é o documento', async () => {
    const r = await callRoute(obterOpenApi, apiRequest('GET', '/v1/openapi.json'))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('public, max-age=300')
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(r.headers.get('vary')).toContain('Origin')
    expect(problemasDoDocumento(objeto(r.json))).toEqual([])
    expect(r.json).toEqual(JSON.parse(JSON.stringify(buildOpenApi())))
  })

  test('com Origin da lista APP_WEB_ORIGINS devolve CORS; de fora, responde sem CORS; as outras respostas da API continuam sem cache', async () => {
    const antes = process.env.APP_WEB_ORIGINS
    process.env.APP_WEB_ORIGINS = 'https://app.exemplo.test'
    try {
      const r = await callRoute(obterOpenApi, apiRequest('GET', '/v1/openapi.json', { origin: 'https://app.exemplo.test' }))
      expect(r.headers.get('access-control-allow-origin')).toBe('https://app.exemplo.test')
      expect(r.headers.get('cache-control')).toBe('public, max-age=300')
      const fora = await callRoute(obterOpenApi, apiRequest('GET', '/v1/openapi.json', { origin: 'https://outro.exemplo.test' }))
      expect(fora.status).toBe(200)
      expect(fora.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      if (antes === undefined) delete process.env.APP_WEB_ORIGINS
      else process.env.APP_WEB_ORIGINS = antes
    }
    const semCache = await callRoute(business, apiRequest('GET', '/v1/business'))
    expect(semCache.headers.get('cache-control')).toBe('no-store')
  })

  test('a própria rota aparece no documento, sem segurança', () => {
    const op = objeto(doc.paths['/v1/openapi.json']?.get)
    expect(op.security).toEqual([])
    expect(op.operationId).toBe('getOpenapiJson')
  })
})
