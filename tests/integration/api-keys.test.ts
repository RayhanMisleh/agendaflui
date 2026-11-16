import { beforeEach, describe, expect, test } from 'vitest'
import type { Business, PlatformAdmin } from '@/server/db/generated/client'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import {
  ApiAuthError,
  createApiKey,
  listApiKeys,
  resolveAppKey,
  revokeApiKey,
  updateApiKeyOrigins,
} from '@/server/domain/platform/api-keys'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

let admin: PlatformAdmin
let actor: PlatformAdminActor
let conta: Business
beforeEach(async () => {
  await resetDb()
  admin = await makePlatformAdmin()
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  conta = await makeBusiness()
})

async function authError(promise: Promise<unknown>): Promise<ApiAuthError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(ApiAuthError)
    return e as ApiAuthError
  }
  throw new Error('Era esperado um erro, mas a chamada terminou sem erro.')
}

const FORMATO = /^afk_[ap]_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/

describe('createApiKey', () => {
  test('devolve o segredo no formato e o banco não o guarda em nenhuma coluna', async () => {
    const { key, secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    expect(secret).toMatch(FORMATO)
    expect(secret.startsWith('afk_a_')).toBe(true)
    expect(key.prefix).toBe(secret.split('_')[2])
    expect(key.allowedOrigins).toEqual([])
    expect(key.businessId).toBe(conta.id)
    expect(key).not.toHaveProperty('secret')
    const linhas = await prisma.$queryRaw<unknown[]>`SELECT to_jsonb(k) AS j FROM api_keys k`
    expect(JSON.stringify(linhas)).not.toContain(secret)
    const p = await createApiKey(actor, { kind: 'PLATFORM', name: 'Geral' })
    expect(p.secret.startsWith('afk_p_')).toBe(true)
    expect(p.key.businessId).toBeNull()
  })

  test('ACCOUNT sem conta, com conta inexistente ou PLATFORM com conta é erro', async () => {
    const e1 = await domainError(createApiKey(actor, { kind: 'ACCOUNT', name: 'X' }))
    expect(e1.code).toBe('validation')
    const e2 = await domainError(createApiKey(actor, { kind: 'ACCOUNT', businessId: crypto.randomUUID(), name: 'X' }))
    expect(e2.code).toBe('not_found')
    const e3 = await domainError(createApiKey(actor, { kind: 'PLATFORM', businessId: conta.id, name: 'X' }))
    expect(e3.code).toBe('validation')
    expect(await prisma.apiKey.count()).toBe(0)
  })

  test('normaliza e remove duplicadas das origens', async () => {
    const { key } = await createApiKey(actor, {
      kind: 'PLATFORM',
      name: 'Web',
      allowedOrigins: ['HTTPS://App.Exemplo.com/', 'https://app.exemplo.com', 'http://localhost:3000', 'http://*.localhost:3000'],
    })
    expect(key.allowedOrigins).toEqual(['https://app.exemplo.com', 'http://localhost:3000', 'http://*.localhost:3000'])
  })

  test.each([
    'app.exemplo.com',
    'https://app.exemplo.com/caminho',
    'https://app.exemplo.com/?a=1',
    'https://app.exemplo.com/#x',
    'https://user:senha@app.exemplo.com',
    'http://app.exemplo.com',
    'https://*.exemplo.com',
    '*',
    'https://*',
    'http://localhost.evil.com',
    'https://evil.com@good.com',
    'https://exemplo.com:0',
    'null',
    'https://-ruim.com',
    'https://ex_emplo.com',
    'https://app.exemplo.com:99999',
    'ftp://app.exemplo.com',
    '',
  ])('recusa a origem %s', async (origem) => {
    const e = await domainError(createApiKey(actor, { kind: 'PLATFORM', name: 'X', allowedOrigins: [origem] }))
    expect(e.code).toBe('validation')
  })

  test('recusa mais de 20 origens distintas, mas conta só depois de normalizar e deduplicar', async () => {
    const origens = Array.from({ length: 21 }, (_, i) => `https://app${i}.exemplo.com`)
    const e = await domainError(createApiKey(actor, { kind: 'PLATFORM', name: 'X', allowedOrigins: origens }))
    expect(e.code).toBe('validation')
    const repetidas = [...origens.slice(0, 20), 'HTTPS://APP0.exemplo.com/']
    const { key } = await createApiKey(actor, { kind: 'PLATFORM', name: 'Y', allowedOrigins: repetidas })
    expect(key.allowedOrigins).toHaveLength(20)
  })

  test('recusa origem com mais de 300 caracteres', async () => {
    const longa = `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`
    expect(longa.length).toBeGreaterThan(300)
    const e = await domainError(createApiKey(actor, { kind: 'PLATFORM', name: 'X', allowedOrigins: [longa] }))
    expect(e.code).toBe('validation')
  })

  test('omite a porta padrão (443 em https, 80 em http) e mantém as outras', async () => {
    const { key } = await createApiKey(actor, {
      kind: 'PLATFORM',
      name: 'Portas',
      allowedOrigins: ['HTTPS://Exemplo.COM:443', 'https://exemplo.com:8443', 'http://localhost:80', 'http://localhost:3000'],
    })
    expect(key.allowedOrigins).toEqual(['https://exemplo.com', 'https://exemplo.com:8443', 'http://localhost', 'http://localhost:3000'])
  })

  test('converte IDN para punycode e aceita punycode pronto', async () => {
    const { key } = await createApiKey(actor, {
      kind: 'PLATFORM',
      name: 'IDN',
      allowedOrigins: ['https://café.com.br', 'https://xn--caf-dma.com.br', 'https://CAFÉ.com.br/'],
    })
    expect(key.allowedOrigins).toEqual(['https://xn--caf-dma.com.br'])
  })

  test('colisão de prefixo sorteia de novo (até 3 tentativas)', async () => {
    const existente = await createApiKey(actor, { kind: 'PLATFORM', name: 'Antiga' })
    const prefixoOcupado = existente.key.prefix
    const sequencia = (ocupadas: number) => {
      let chamadas = 0
      return (n: number): Buffer => {
        if (n === 32) return Buffer.alloc(32, 7)
        chamadas++
        return chamadas <= ocupadas ? Buffer.from(prefixoOcupado, 'hex') : Buffer.from('00112233', 'hex')
      }
    }
    const { key, secret } = await createApiKey(actor, { kind: 'PLATFORM', name: 'Nova' }, { randomBytes: sequencia(2) })
    expect(key.prefix).toBe('00112233')
    expect(secret).toMatch(FORMATO)
    await expect(createApiKey(actor, { kind: 'PLATFORM', name: 'Outra' }, { randomBytes: sequencia(3) })).rejects.toThrow()
  })

  test('audita sem o segredo, com o ator da plataforma', async () => {
    const { key, secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    const logs = await prisma.auditLog.findMany({ where: { action: 'api_key.created' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      actorType: 'PLATFORM_ADMIN',
      actorId: admin.id,
      targetType: 'api_key',
      targetId: key.id,
      businessId: conta.id,
    })
    expect(JSON.stringify(logs)).not.toContain(secret)
    expect(JSON.stringify(logs)).not.toContain(secret.slice(-43))
  })
})

describe('resolveAppKey', () => {
  test('chave de conta resolve a conta; slug igual é aceito', async () => {
    const { secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App', allowedOrigins: ['https://a.exemplo.com'] })
    for (const businessSlug of [null, conta.slug]) {
      const r = await resolveAppKey({ key: secret, businessSlug })
      expect(r).toMatchObject({
        kind: 'ACCOUNT',
        businessId: conta.id,
        businessSlug: conta.slug,
        timeZone: conta.timezone,
        allowedOrigins: ['https://a.exemplo.com'],
      })
    }
  })

  test('chave de conta com slug de outra conta é forbidden', async () => {
    const outra = await makeBusiness()
    const { secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    const e = await authError(resolveAppKey({ key: secret, businessSlug: outra.slug }))
    expect(e).toMatchObject({ code: 'forbidden', reason: 'business_mismatch' })
  })

  test('chave de plataforma exige slug de conta existente', async () => {
    const { secret } = await createApiKey(actor, { kind: 'PLATFORM', name: 'Geral' })
    const r = await resolveAppKey({ key: secret, businessSlug: conta.slug })
    expect(r).toMatchObject({ kind: 'PLATFORM', businessId: conta.id, businessSlug: conta.slug })
    const semSlug = await authError(resolveAppKey({ key: secret, businessSlug: null }))
    expect(semSlug).toMatchObject({ code: 'unauthorized', reason: 'unknown_business' })
    const inexistente = await authError(resolveAppKey({ key: secret, businessSlug: 'nao-existe' }))
    expect(inexistente).toMatchObject({ code: 'unauthorized', reason: 'unknown_business' })
  })

  test('conta que não está ativa é business_unavailable', async () => {
    const { secret } = await createApiKey(actor, { kind: 'PLATFORM', name: 'Geral' })
    const contaKey = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    await prisma.business.update({ where: { id: conta.id }, data: { status: 'SUSPENDED' } })
    const e1 = await authError(resolveAppKey({ key: secret, businessSlug: conta.slug }))
    expect(e1.code).toBe('business_unavailable')
    const e2 = await authError(resolveAppKey({ key: contaKey.secret, businessSlug: null }))
    expect(e2.code).toBe('business_unavailable')
  })

  test('ausente, malformada, inexistente, errada e revogada dão exatamente a mesma resposta', async () => {
    const { key, secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    const ultimo = secret.slice(-1)
    const trocada = secret.slice(0, -1) + (ultimo === 'A' ? 'B' : 'A')
    const restoErrado = `afk_a_${key.prefix}_${'x'.repeat(43)}`
    const prefixoInexistente = secret.replace(`_${key.prefix}_`, '_00000000_')
    const revogada = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'Velha' })
    await revokeApiKey(actor, revogada.key.id)
    const casos: Array<string | null> = [null, '', 'lixo', trocada, restoErrado, prefixoInexistente, revogada.secret]
    const respostas: Array<{ code: string; reason: string; message: string }> = []
    for (const k of casos) {
      const e = await authError(resolveAppKey({ key: k, businessSlug: conta.slug }))
      respostas.push({ code: e.code, reason: e.reason, message: e.message })
      expect(e.message, String(k)).not.toContain(secret)
    }
    expect(respostas[0]).toMatchObject({ code: 'unauthorized', reason: 'invalid_app_key' })
    for (const r of respostas) expect(r).toEqual(respostas[0])
    await expect(resolveAppKey({ key: secret, businessSlug: null })).resolves.toBeDefined()
  })

  test('o slug é normalizado (espaços e maiúsculas); vazio vale como ausente', async () => {
    const { secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    expect((await resolveAppKey({ key: secret, businessSlug: ` ${conta.slug.toUpperCase()} ` })).businessId).toBe(conta.id)
    expect((await resolveAppKey({ key: secret, businessSlug: '   ' })).businessId).toBe(conta.id)
    const p = await createApiKey(actor, { kind: 'PLATFORM', name: 'Geral' })
    expect((await resolveAppKey({ key: p.secret, businessSlug: conta.slug.toUpperCase() })).businessId).toBe(conta.id)
    const e = await authError(resolveAppKey({ key: p.secret, businessSlug: '  ' }))
    expect(e.reason).toBe('unknown_business')
  })

  test('lastUsedAt é gravado no máximo uma vez por minuto', async () => {
    const { key, secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    const t0 = new Date('2026-11-16T12:00:00.000Z')
    const lido = async () => (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).lastUsedAt
    expect(await lido()).toBeNull()
    await resolveAppKey({ key: secret, businessSlug: null, now: t0 })
    expect(await lido()).toEqual(t0)
    await resolveAppKey({ key: secret, businessSlug: null, now: new Date(t0.getTime() + 59_000) })
    expect(await lido()).toEqual(t0)
    const t2 = new Date(t0.getTime() + 61_000)
    await resolveAppKey({ key: secret, businessSlug: null, now: t2 })
    expect(await lido()).toEqual(t2)
  })
})

describe('revogar, listar e atualizar origens', () => {
  test('revogar marca a data, audita e a chave deixa de valer; repetir não muda a data', async () => {
    const { key, secret } = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'App' })
    const t = new Date('2026-11-16T12:00:00.000Z')
    await revokeApiKey(actor, key.id, t)
    const depois = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
    expect(depois.revokedAt).toEqual(t)
    await revokeApiKey(actor, key.id)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toEqual(depois.revokedAt)
    expect(await prisma.auditLog.count({ where: { action: 'api_key.revoked' } })).toBe(1)
    await authError(resolveAppKey({ key: secret, businessSlug: null }))
    const e = await domainError(revokeApiKey(actor, crypto.randomUUID()))
    expect(e.code).toBe('not_found')
    const m = await domainError(revokeApiKey(actor, 'malformado'))
    expect(m.code).toBe('not_found')
  })

  test('listar filtra por conta, ordena e nunca expõe hash nem segredo', async () => {
    const outra = await makeBusiness()
    const a = await createApiKey(actor, { kind: 'ACCOUNT', businessId: conta.id, name: 'A' })
    await createApiKey(actor, { kind: 'ACCOUNT', businessId: outra.id, name: 'B' })
    await createApiKey(actor, { kind: 'PLATFORM', name: 'P' })
    expect(await listApiKeys(actor)).toHaveLength(3)
    const dela = await listApiKeys(actor, { businessId: conta.id })
    expect(dela.map((k) => k.id)).toEqual([a.key.id])
    expect(Object.keys(dela[0]!).sort()).toEqual(
      ['allowedOrigins', 'businessId', 'createdAt', 'id', 'kind', 'lastUsedAt', 'name', 'prefix', 'revokedAt'].sort(),
    )
  })

  test('atualizar origens normaliza, valida e audita', async () => {
    const { key } = await createApiKey(actor, { kind: 'PLATFORM', name: 'P' })
    const v = await updateApiKeyOrigins(actor, key.id, ['https://B.exemplo.com/', 'https://b.exemplo.com'])
    expect(v.allowedOrigins).toEqual(['https://b.exemplo.com'])
    const limpa = await updateApiKeyOrigins(actor, key.id, [])
    expect(limpa.allowedOrigins).toEqual([])
    const e = await domainError(updateApiKeyOrigins(actor, key.id, ['https://x.com/a']))
    expect(e.code).toBe('validation')
    const nf = await domainError(updateApiKeyOrigins(actor, crypto.randomUUID(), []))
    expect(nf.code).toBe('not_found')
    const logs = await prisma.auditLog.findMany({ where: { action: 'api_key.origins_updated' }, orderBy: { createdAt: 'asc' } })
    expect(logs).toHaveLength(2)
    expect(logs[0]?.metadata).toMatchObject({ before: [], after: ['https://b.exemplo.com'] })
    expect(logs[1]?.metadata).toMatchObject({ before: ['https://b.exemplo.com'], after: [] })
  })

  test('atualizar origens de chave revogada é recusado, sem gravar nem auditar', async () => {
    const { key } = await createApiKey(actor, { kind: 'PLATFORM', name: 'P', allowedOrigins: ['https://a.exemplo.com'] })
    await revokeApiKey(actor, key.id)
    const e = await domainError(updateApiKeyOrigins(actor, key.id, ['https://b.exemplo.com']))
    expect(e.code).toBe('validation')
    expect(e.message).toBe('Esta chave foi revogada. Crie uma nova chave.')
    const depois = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
    expect(depois.allowedOrigins).toEqual(['https://a.exemplo.com'])
    expect(await prisma.auditLog.count({ where: { action: 'api_key.origins_updated' } })).toBe(0)
  })

  test('funções administrativas recusam quem não é admin da plataforma', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    const { key } = await createApiKey(actor, { kind: 'PLATFORM', name: 'P' })
    for (const chamada of [
      createApiKey(intruso, { kind: 'PLATFORM', name: 'X' }),
      listApiKeys(intruso),
      revokeApiKey(intruso, key.id),
      updateApiKeyOrigins(intruso, key.id, []),
    ]) {
      expect((await domainError(chamada)).code).toBe('forbidden')
    }
    expect(await prisma.apiKey.count()).toBe(1)
  })
})
