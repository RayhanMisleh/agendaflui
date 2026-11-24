import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { openSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'
import { tenantDb, TenantViolationError } from '@/server/db/tenant'
import { clearGoogleSettings, getGoogleSettings, GOOGLE_SECRET_AAD, isGoogleConfigured, saveGoogleSettings } from '@/server/domain/platform/google-settings'
import { readGoogleClient } from '@/server/domain/platform/google-secrets'
import { env } from '@/server/env'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

// Valores inventados só para este teste.
const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const ID_2 = '987654321098-zyxwvu9876543210.apps.googleusercontent.com'
const SEGREDO = 'GOCSPX-abcdef0123456789Qz7K'
const SEGREDO_2 = 'GOCSPX-uvwxyz9876543210Wx3P'
const NOW = new Date('2026-11-23T15:00:00Z')

let admin: PlatformAdminActor

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  admin = { kind: 'platform_admin', adminId: a.id, name: a.name }
})

describe('chaves do Google no dev', () => {
  test('só admin ativo', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(getGoogleSettings(intruso))).code).toBe('forbidden')
    expect((await domainError(saveGoogleSettings(intruso, { clientId: ID, clientSecret: SEGREDO }, 0, NOW))).code).toBe('forbidden')
    expect((await domainError(clearGoogleSettings(intruso, 0, NOW))).code).toBe('forbidden')
    await prisma.platformAdmin.update({ where: { id: admin.adminId }, data: { active: false } })
    expect((await domainError(saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW))).code).toBe('forbidden')
    expect(await isGoogleConfigured()).toBe(false)
  })

  test('primeira gravação exige a chave secreta', async () => {
    const e = await domainError(saveGoogleSettings(admin, { clientId: ID }, 0, NOW))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('clientSecret')
    const e2 = await domainError(saveGoogleSettings(admin, { clientId: 'qualquer coisa', clientSecret: SEGREDO }, 0, NOW))
    expect(e2.fields?.clientId).toBe('Cole o ID do cliente do Google (termina em .apps.googleusercontent.com).')
    const e3 = await domainError(saveGoogleSettings(admin, { clientId: ID, clientSecret: 'curta' }, 0, NOW))
    expect(e3.fields?.clientSecret).toBe('Cole a chave secreta do cliente do Google.')
    expect(JSON.stringify(e3)).not.toContain('curta')
    expect(await isGoogleConfigured()).toBe(false)
  })

  test('grava selado: o banco não guarda o texto e readGoogleClient abre com platform:google:client_secret', async () => {
    const v = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    expect(v.configured).toBe(true)
    const linha = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } })
    expect(linha.googleClientSecretEnc).toMatch(/^v1\./)
    expect(JSON.stringify(await prisma.$queryRaw<unknown[]>`select * from platform_settings`)).not.toContain(SEGREDO)
    expect(openSecret(linha.googleClientSecretEnc ?? '', GOOGLE_SECRET_AAD)).toBe(SEGREDO)
    expect(GOOGLE_SECRET_AAD).toBe('platform:google:client_secret')
    expect(await readGoogleClient()).toEqual({ clientId: ID, clientSecret: SEGREDO })
    expect(await isGoogleConfigured()).toBe(true)
  })

  test('a visão nunca traz o segredo: traz os 4 últimos, a data e a URL de retorno', async () => {
    const v = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    expect(v.secretLast4).toBe('Qz7K')
    expect(v.updatedAt).toEqual(NOW)
    expect(v.clientId).toBe(ID)
    expect(v.redirectUrl).toBe(`http://${env.APP_HOST}/google/retorno`)
    expect(v.redirectUrl).toBe('http://app.localhost:3000/google/retorno')
    expect(JSON.stringify(v)).not.toContain(SEGREDO)
    expect(JSON.stringify(await getGoogleSettings(admin))).not.toContain(SEGREDO)
    const vazio = await getGoogleSettings(admin)
    expect(vazio.version).toBe(v.version)
  })

  test('trocar só o ID mantém a chave', async () => {
    const v1 = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    const v2 = await saveGoogleSettings(admin, { clientId: ID_2, clientSecret: null }, v1.version, NOW)
    expect(v2.version).toBe(v1.version + 1)
    expect(v2.secretLast4).toBe('Qz7K')
    expect(await readGoogleClient()).toEqual({ clientId: ID_2, clientSecret: SEGREDO })
    await saveGoogleSettings(admin, { clientId: ID_2, clientSecret: SEGREDO_2 }, v2.version, NOW)
    expect(await readGoogleClient()).toEqual({ clientId: ID_2, clientSecret: SEGREDO_2 })
  })

  test('versão velha: stale_version', async () => {
    const v1 = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    await saveGoogleSettings(admin, { clientId: ID_2, clientSecret: SEGREDO_2 }, v1.version, NOW)
    const e = await domainError(saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, v1.version, NOW))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('stale_version')
    expect((await domainError(clearGoogleSettings(admin, v1.version, NOW))).reason).toBe('stale_version')
    expect(await readGoogleClient()).toEqual({ clientId: ID_2, clientSecret: SEGREDO_2 })
  })

  test('remover: isGoogleConfigured falso e readGoogleClient nulo', async () => {
    const v1 = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    const v2 = await clearGoogleSettings(admin, v1.version, NOW)
    expect(v2.configured).toBe(false)
    expect(v2.clientId).toBeNull()
    expect(v2.secretLast4).toBeNull()
    expect(await isGoogleConfigured()).toBe(false)
    expect(await readGoogleClient()).toBeNull()
    const linha = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } })
    expect(linha.googleClientSecretEnc).toBeNull()
  })

  test('selo adulterado: readGoogleClient nulo e log só com o nome do erro', async () => {
    await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    const linha = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } })
    const adulterado = `${(linha.googleClientSecretEnc ?? '').slice(0, -2)}AA`
    await prisma.platformSetting.update({ where: { id: 1 }, data: { googleClientSecretEnc: adulterado } })
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await readGoogleClient()).toBeNull()
    const saida = erro.mock.calls.map((c) => String(c[0])).join('\n')
    erro.mockRestore()
    expect(saida).toContain('SecretBoxError')
    expect(saida).not.toContain(SEGREDO)
    expect(saida).not.toContain(adulterado)
  })

  test('auditoria guarda só os nomes dos campos', async () => {
    const v1 = await saveGoogleSettings(admin, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
    await saveGoogleSettings(admin, { clientId: ID_2, clientSecret: null }, v1.version, NOW)
    await clearGoogleSettings(admin, v1.version + 1, NOW)
    const linhas = await prisma.auditLog.findMany({ where: { targetType: 'platform_settings' }, orderBy: { createdAt: 'asc' } })
    expect(linhas.map((l) => l.action)).toEqual(['platform.google_updated', 'platform.google_updated', 'platform.google_cleared'])
    expect(linhas.every((l) => l.businessId === null && l.targetId === '1')).toBe(true)
    expect(linhas[0]?.metadata).toEqual({ fields: ['clientId', 'clientSecret'] })
    expect(linhas[1]?.metadata).toEqual({ fields: ['clientId'] })
    const tudo = JSON.stringify(linhas)
    for (const x of [SEGREDO, ID, ID_2, 'Qz7K']) expect(tudo).not.toContain(x)
  })

  test('tenantDb recusa a tabela de plataforma', async () => {
    const conta = await makeBusiness()
    const db = tenantDb(conta.id) as unknown as { platformSetting: { findMany: () => Promise<unknown> } }
    await expect(Promise.resolve().then(() => db.platformSetting.findMany())).rejects.toBeInstanceOf(TenantViolationError)
  })
})
