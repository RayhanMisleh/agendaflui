import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { openSecret, sealSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'
import { tenantDb, TenantViolationError } from '@/server/db/tenant'
import { clearFrenet, clearMercadoPago, getIntegrations, setFrenet, setMercadoPago } from '@/server/domain/platform/integrations'
import {
  findMercadoPagoByWebhookKey,
  integrationStatus,
  readFrenetToken,
  readMercadoPagoSecrets,
} from '@/server/domain/platform/integration-secrets'
import { env } from '@/server/env'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

// Valores inventados só para este teste.
const TOKEN = 'TEST-a1b2c3d4e5f6g7h8i9j0-Qz7K'
const TOKEN_2 = 'APP_USR-k9l8m7n6o5p4q3r2s1t0-Wx3P'
const SEGREDO = 'whsecabcdef0123456789Hy5N'
const SEGREDO_2 = 'whsecuvwxyz9876543210Jm2R'
const FRENET = 'FRENET-TOKEN-0123456789-Vb6D'
const FINAIS = ['Qz7K', 'Wx3P', 'Hy5N', 'Jm2R', 'Vb6D']

let admin: PlatformAdminActor
let conta: Awaited<ReturnType<typeof makeBusiness>>

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  admin = { kind: 'platform_admin', adminId: a.id, name: a.name }
  conta = await makeBusiness()
})

/** A linha inteira da tabela como texto, para procurar segredo em qualquer coluna. */
async function linhaCrua(businessId: string): Promise<string> {
  const linhas = await prisma.$queryRaw<unknown[]>`select * from business_integrations where business_id = ${businessId}::uuid`
  return JSON.stringify(linhas)
}

describe('getIntegrations', () => {
  test('conta sem linha: nada configurado e versão 0', async () => {
    const v = await getIntegrations(admin, conta.id)
    expect(v).toEqual({
      version: 0,
      mercadoPago: { configured: false, accessTokenLast4: null, webhookSecretLast4: null, webhookUrl: null, updatedLabel: null },
      frenet: { configured: false, tokenLast4: null, updatedLabel: null },
    })
    expect(await integrationStatus(conta.id)).toEqual({ mercadoPago: false, frenet: false })
  })

  test('só o admin da plataforma lê e grava', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(getIntegrations(intruso, conta.id))).code).toBe('forbidden')
    expect((await domainError(setFrenet(intruso, conta.id, 0, { token: FRENET }))).code).toBe('forbidden')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('o suporte (admin entrando como) não lê nem grava', async () => {
    const suporte = { kind: 'impersonator', adminId: admin.adminId, name: admin.name } as unknown as PlatformAdminActor
    expect((await domainError(getIntegrations(suporte, conta.id))).code).toBe('forbidden')
    expect((await domainError(setFrenet(suporte, conta.id, 0, { token: FRENET }))).code).toBe('forbidden')
    expect((await domainError(setMercadoPago(suporte, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO }))).code).toBe('forbidden')
    expect((await domainError(clearFrenet(suporte, conta.id, 0))).code).toBe('forbidden')
    expect((await domainError(clearMercadoPago(suporte, conta.id, 0))).code).toBe('forbidden')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('a data da gravação vem do relógio informado', async () => {
    const instante = new Date('2026-11-17T15:00:00Z')
    await setFrenet(admin, conta.id, 0, { token: FRENET }, instante)
    expect((await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })).frenetUpdatedAt).toEqual(instante)
  })

  test('admin desativado não grava', async () => {
    await prisma.platformAdmin.update({ where: { id: admin.adminId }, data: { active: false } })
    expect((await domainError(setFrenet(admin, conta.id, 0, { token: FRENET }))).code).toBe('forbidden')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })
})

describe('Mercado Pago', () => {
  test('na primeira vez exige os dois segredos (só o token: validation)', async () => {
    const e = await domainError(setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('webhookSecret')
    expect(JSON.stringify(e)).not.toContain(TOKEN)
    const e2 = await domainError(setMercadoPago(admin, conta.id, 0, { webhookSecret: SEGREDO }))
    expect(e2.fields).toHaveProperty('accessToken')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('com os dois: configurado, finais certos, URL no host da API e nenhuma coluna com o texto puro', async () => {
    const v = await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    expect(v.version).toBe(1)
    expect(v.mercadoPago.configured).toBe(true)
    expect(v.mercadoPago.accessTokenLast4).toBe('Qz7K')
    expect(v.mercadoPago.webhookSecretLast4).toBe('Hy5N')
    expect(v.mercadoPago.updatedLabel).toBeTruthy()
    const linha = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    expect(v.mercadoPago.webhookUrl).toBe(`http://${env.API_HOST}/v1/webhooks/mercadopago/${linha.mpWebhookKey}`)
    expect(linha.mpWebhookKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const crua = await linhaCrua(conta.id)
    expect(crua).not.toContain(TOKEN)
    expect(crua).not.toContain(SEGREDO)
    expect(linha.mpAccessTokenEnc).toMatch(/^v1\./)
    expect(linha.mpWebhookSecretEnc).toMatch(/^v1\./)
    expect(JSON.stringify(v)).not.toContain(TOKEN)
    expect(JSON.stringify(v)).not.toContain(SEGREDO)
    expect(await integrationStatus(conta.id)).toEqual({ mercadoPago: true, frenet: false })
  })

  test('a leitura devolve os segredos em texto só por integration-secrets', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN, webhookSecret: SEGREDO })
    const chave = (await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })).mpWebhookKey ?? ''
    expect(await findMercadoPagoByWebhookKey(chave)).toEqual({ businessId: conta.id, accessToken: TOKEN, webhookSecret: SEGREDO })
  })

  test('trocar só o segredo mantém o token e a chave do webhook', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    const antes = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    const v = await setMercadoPago(admin, conta.id, 1, { webhookSecret: SEGREDO_2 })
    expect(v.version).toBe(2)
    expect(v.mercadoPago.accessTokenLast4).toBe('Qz7K')
    expect(v.mercadoPago.webhookSecretLast4).toBe('Jm2R')
    const depois = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    expect(depois.mpWebhookKey).toBe(antes.mpWebhookKey)
    expect(depois.mpAccessTokenEnc).toBe(antes.mpAccessTokenEnc)
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN, webhookSecret: SEGREDO_2 })
  })

  test('trocar só o token mantém o segredo', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    await setMercadoPago(admin, conta.id, 1, { accessToken: TOKEN_2 })
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN_2, webhookSecret: SEGREDO })
  })

  test('clearMercadoPago remove os segredos e troca a chave do webhook na próxima configuração', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    const antes = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    const v = await clearMercadoPago(admin, conta.id, 1)
    expect(v.mercadoPago).toEqual({ configured: false, accessTokenLast4: null, webhookSecretLast4: null, webhookUrl: null, updatedLabel: null })
    expect(await readMercadoPagoSecrets(conta.id)).toBeNull()
    expect(await findMercadoPagoByWebhookKey(antes.mpWebhookKey ?? 'x')).toBeNull()
    await setMercadoPago(admin, conta.id, v.version, { accessToken: TOKEN, webhookSecret: SEGREDO })
    const depois = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    expect(depois.mpWebhookKey).not.toBe(antes.mpWebhookKey)
  })

  test('formatos inválidos viram erro de campo sem repetir o valor', async () => {
    for (const [campo, valor] of [
      ['accessToken', 'sem-prefixo-1234567890123456'],
      ['accessToken', 'TEST-curto'],
      ['accessToken', 'TEST-com espaco no meio 123456789'],
      ['webhookSecret', 'curto'],
      ['webhookSecret', 'tem-hifen-e-mais-de-dezesseis'],
    ] as const) {
      const entrada = { accessToken: TOKEN, webhookSecret: SEGREDO, [campo]: valor }
      const e = await domainError(setMercadoPago(admin, conta.id, 0, entrada))
      expect(e.code, `${campo}=${valor}`).toBe('validation')
      expect(e.fields).toHaveProperty(campo)
      expect(JSON.stringify(e)).not.toContain(valor)
      expect(e.message).not.toContain(valor)
    }
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('espaços nas pontas são removidos antes de validar e gravar', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: `  ${TOKEN} `, webhookSecret: `${SEGREDO}\n` })
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN, webhookSecret: SEGREDO })
  })

  test('versão antiga devolve conflict (stale_version) e não grava', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    const e = await domainError(setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN_2, webhookSecret: SEGREDO_2 }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('stale_version')
    const e2 = await domainError(setMercadoPago(admin, conta.id, 5, { webhookSecret: SEGREDO_2 }))
    expect(e2.reason).toBe('stale_version')
    const e3 = await domainError(clearMercadoPago(admin, conta.id, 7))
    expect(e3.reason).toBe('stale_version')
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN, webhookSecret: SEGREDO })
  })

  test('duas gravações simultâneas sobre a mesma versão: uma passa e a outra é conflito', async () => {
    const r = await Promise.allSettled([
      setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO }),
      setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN_2, webhookSecret: SEGREDO_2 }),
    ])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const rejeitada = r.find((x) => x.status === 'rejected')
    expect((rejeitada as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict', reason: 'stale_version' })
  })

  test('conta que não existe: not_found', async () => {
    const e = await domainError(setMercadoPago(admin, '99999999-9999-4999-8999-999999999999', 0, { accessToken: TOKEN, webhookSecret: SEGREDO }))
    expect(e.code).toBe('not_found')
    expect((await domainError(getIntegrations(admin, 'nao-e-uuid'))).code).toBe('not_found')
  })
})

describe('Frenet', () => {
  test('grava, mostra só o final e lê o token por integration-secrets', async () => {
    const v = await setFrenet(admin, conta.id, 0, { token: FRENET })
    expect(v.frenet.configured).toBe(true)
    expect(v.frenet.tokenLast4).toBe('Vb6D')
    expect(v.frenet.updatedLabel).toBeTruthy()
    expect(v.mercadoPago.configured).toBe(false)
    expect(JSON.stringify(v)).not.toContain(FRENET)
    expect(await linhaCrua(conta.id)).not.toContain(FRENET)
    expect(await readFrenetToken(conta.id)).toBe(FRENET)
    expect(await integrationStatus(conta.id)).toEqual({ mercadoPago: false, frenet: true })
  })

  test('formato inválido: erro de campo `token` sem repetir o valor', async () => {
    for (const ruim of ['curto', 'tem espaco no meio do token 123', 'token_com_underscore_1234567890']) {
      const e = await domainError(setFrenet(admin, conta.id, 0, { token: ruim }))
      expect(e.fields).toHaveProperty('token')
      expect(JSON.stringify(e)).not.toContain(ruim)
    }
  })

  test('clearFrenet remove só a Frenet', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    await setFrenet(admin, conta.id, 1, { token: FRENET })
    const v = await clearFrenet(admin, conta.id, 2)
    expect(v.frenet).toEqual({ configured: false, tokenLast4: null, updatedLabel: null })
    expect(v.mercadoPago.configured).toBe(true)
    expect(await readFrenetToken(conta.id)).toBeNull()
    expect(await readMercadoPagoSecrets(conta.id)).not.toBeNull()
  })

  test('versão antiga: conflict', async () => {
    await setFrenet(admin, conta.id, 0, { token: FRENET })
    expect((await domainError(setFrenet(admin, conta.id, 0, { token: FRENET }))).reason).toBe('stale_version')
  })
})

describe('auditoria', () => {
  test('cada gravação audita na mesma transação, sem valor nem final', async () => {
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    await setMercadoPago(admin, conta.id, 1, { webhookSecret: SEGREDO_2 })
    await clearMercadoPago(admin, conta.id, 2)
    await setFrenet(admin, conta.id, 3, { token: FRENET })
    await clearFrenet(admin, conta.id, 4)
    const logs = await prisma.auditLog.findMany({ where: { businessId: conta.id, action: { startsWith: 'integration.' } }, orderBy: { createdAt: 'asc' } })
    expect(logs.map((l) => l.action)).toEqual([
      'integration.mercadopago.updated',
      'integration.mercadopago.updated',
      'integration.mercadopago.cleared',
      'integration.frenet.updated',
      'integration.frenet.cleared',
    ])
    expect(logs.map((l) => (l.metadata as { fields: string[] }).fields)).toEqual([
      ['accessToken', 'webhookSecret'],
      ['webhookSecret'],
      ['accessToken', 'webhookSecret'],
      ['token'],
      ['token'],
    ])
    for (const l of logs) {
      expect(l.actorType).toBe('PLATFORM_ADMIN')
      expect(l.actorId).toBe(admin.adminId)
      const json = JSON.stringify(l)
      for (const proibido of [TOKEN, TOKEN_2, SEGREDO, SEGREDO_2, FRENET, ...FINAIS]) expect(json).not.toContain(proibido)
    }
  })

  test('gravação recusada não deixa auditoria', async () => {
    await domainError(setMercadoPago(admin, conta.id, 0, { accessToken: 'ruim', webhookSecret: SEGREDO }))
    await setFrenet(admin, conta.id, 0, { token: FRENET })
    await domainError(setFrenet(admin, conta.id, 0, { token: FRENET }))
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'integration.' } } })).toBe(1)
  })
})

describe('isolamento entre contas', () => {
  test('findMercadoPagoByWebhookKey com chave desconhecida devolve null', async () => {
    expect(await findMercadoPagoByWebhookKey('chave-que-nao-existe')).toBeNull()
    expect(await findMercadoPagoByWebhookKey('')).toBeNull()
  })

  test('a cifra da conta A copiada para a linha de B não abre: as leituras devolvem null e o log só traz o nome do erro', async () => {
    const b = await makeBusiness()
    await setMercadoPago(admin, conta.id, 0, { accessToken: TOKEN, webhookSecret: SEGREDO })
    await setFrenet(admin, conta.id, 1, { token: FRENET })
    const a = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: conta.id } })
    await prisma.businessIntegration.create({
      data: {
        businessId: b.id,
        mpAccessTokenEnc: a.mpAccessTokenEnc,
        mpAccessTokenLast4: a.mpAccessTokenLast4,
        mpWebhookSecretEnc: a.mpWebhookSecretEnc,
        mpWebhookSecretLast4: a.mpWebhookSecretLast4,
        mpWebhookKey: 'chave-de-b-inventada-so-do-teste',
        frenetTokenEnc: a.frenetTokenEnc,
        frenetTokenLast4: a.frenetTokenLast4,
      },
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await readMercadoPagoSecrets(b.id)).toBeNull()
      expect(await readFrenetToken(b.id)).toBeNull()
      expect(await findMercadoPagoByWebhookKey('chave-de-b-inventada-so-do-teste')).toBeNull()
      const escrito = JSON.stringify(log.mock.calls)
      expect(escrito).toContain('SecretBoxError')
      for (const proibido of [TOKEN, SEGREDO, FRENET, a.mpAccessTokenEnc ?? 'x', a.frenetTokenEnc ?? 'x']) expect(escrito).not.toContain(proibido)
    } finally {
      log.mockRestore()
    }
    // A conta A continua abrindo os dela.
    expect(await readFrenetToken(conta.id)).toBe(FRENET)
  })

  test('a leitura de uma conta sem linha devolve null', async () => {
    expect(await readMercadoPagoSecrets(conta.id)).toBeNull()
    expect(await readFrenetToken(conta.id)).toBeNull()
  })

  test('tenantDb(A).businessIntegration é recusado (modelo de plataforma)', async () => {
    await expect(tenantDb(conta.id).businessIntegration.findMany()).rejects.toThrow(TenantViolationError)
  })

  test('tenantDb(A) recusa também chegar à linha pela relação `integrations` da conta', async () => {
    await setFrenet(admin, conta.id, 0, { token: FRENET })
    const db = tenantDb(conta.id)
    await expect(db.business.findUnique({ where: { id: conta.id }, include: { integrations: true } })).rejects.toThrow(TenantViolationError)
    await expect(db.business.findUnique({ where: { id: conta.id }, select: { integrations: { select: { frenetTokenEnc: true } } } })).rejects.toThrow(TenantViolationError)
  })
})

describe('banco', () => {
  test('CHECK: cifra e final de cada segredo ficam nulos juntos', async () => {
    const selo = sealSecret(FRENET, `${conta.id}:frenet:token`)
    expect(openSecret(selo, `${conta.id}:frenet:token`)).toBe(FRENET)
    await expect(prisma.businessIntegration.create({ data: { businessId: conta.id, frenetTokenEnc: selo } })).rejects.toThrow()
    await expect(prisma.businessIntegration.create({ data: { businessId: conta.id, frenetTokenLast4: 'Vb6D' } })).rejects.toThrow()
    await expect(prisma.businessIntegration.create({ data: { businessId: conta.id, mpAccessTokenEnc: selo, mpAccessTokenLast4: 'Vb6D' } })).resolves.toBeTruthy()
  })

  test('a chave do webhook é única entre contas', async () => {
    const b = await makeBusiness()
    await prisma.businessIntegration.create({ data: { businessId: conta.id, mpWebhookKey: 'mesma-chave' } })
    await expect(prisma.businessIntegration.create({ data: { businessId: b.id, mpWebhookKey: 'mesma-chave' } })).rejects.toThrow()
  })

  test('apagar a conta apaga a linha (cascade)', async () => {
    await setFrenet(admin, conta.id, 0, { token: FRENET })
    await prisma.business.delete({ where: { id: conta.id } })
    expect(await prisma.businessIntegration.count()).toBe(0)
  })
})
