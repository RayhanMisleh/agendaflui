import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { updateModules, updateNotificationsAsAdmin, updateRulesAsAdmin, updateTerms } from '@/server/domain/platform/customization'
import { updateTermsAsOwner } from '@/server/domain/settings/business-profile'
import {
  getNotificationSettingsView,
  updateNotificationSettings,
} from '@/server/domain/settings/notification-settings'
import { getSchedulingRules, updateSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makePlatformAdmin } from '../setup/factories'

type Admin = Extract<Actor, { kind: 'platform_admin' }>

let admin: Admin
let biz: Awaited<ReturnType<typeof makeBusiness>>

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  admin = { kind: 'platform_admin', adminId: a.id, name: a.name }
  biz = await makeBusiness()
})

const TERMOS = {
  professionalSingular: 'Tosador',
  professionalPlural: 'Tosadores',
  customerSingular: 'Tutor',
  customerPlural: 'Tutores',
  pointsSingular: 'Patinha',
  pointsPlural: 'Patinhas',
  club: 'Clube Pet',
}
const versaoDasConfig = async () => (await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: biz.id } })).version

const stale = (e: { code: string; reason?: string | undefined }) => [e.code, e.reason]

describe('versão das configurações', () => {
  test('nasce em 1 e cada gravação que muda algo sobe uma vez, em termos, regras e avisos', async () => {
    const dono = await makeCtx(biz)
    expect(await versaoDasConfig()).toBe(1)
    await updateTermsAsOwner(dono, 1, TERMOS)
    expect(await versaoDasConfig()).toBe(2)
    const r = await updateSchedulingRules(dono, { bufferMin: 10 }, 2)
    expect(r.version).toBe(3)
    await updateNotificationSettings(dono, { APPOINTMENT_CONFIRMED: { email: false } }, 3)
    expect(await versaoDasConfig()).toBe(4)
    expect((await getNotificationSettingsView(dono)).version).toBe(4)
    expect((await getSchedulingRules(dono)).version).toBe(4)
  })

  test('gravação sem versão informada grava e sobe (chamadores antigos)', async () => {
    const dono = await makeCtx(biz)
    expect((await updateSchedulingRules(dono, { slotStepMin: 30 })).version).toBe(2)
    await updateNotificationSettings(dono, { APPOINTMENT_CANCELED: { email: false } })
    expect(await versaoDasConfig()).toBe(3)
  })

  test('gravação sem mudança não sobe a versão nem audita', async () => {
    const dono = await makeCtx(biz)
    await updateSchedulingRules(dono, { bufferMin: 0, autoConfirm: true }, 1)
    await updateSchedulingRules(dono, {}, 1)
    await updateNotificationSettings(dono, { APPOINTMENT_CONFIRMED: { email: true } }, 1)
    await updateTermsAsOwner(dono, 1, { ...TERMOS })
    await updateTermsAsOwner(dono, 2, TERMOS)
    expect(await versaoDasConfig()).toBe(2)
    expect(await prisma.auditLog.count({ where: { businessId: biz.id, action: 'scheduling_rules.updated' } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { businessId: biz.id, action: 'notification_settings.updated' } })).toBe(0)
  })

  test('versão antiga dá conflict stale_version em regras e avisos e nada é gravado', async () => {
    const dono = await makeCtx(biz)
    await updateSchedulingRules(dono, { bufferMin: 10 }, 1)
    expect(stale(await domainError(updateSchedulingRules(dono, { bufferMin: 20 }, 1)))).toEqual(['conflict', 'stale_version'])
    expect(stale(await domainError(updateNotificationSettings(dono, { APPOINTMENT_REMINDER_1H: { email: false } }, 1)))).toEqual(['conflict', 'stale_version'])
    expect((await getSchedulingRules(dono)).bufferMin).toBe(10)
    expect((await getNotificationSettingsView(dono)).settings.APPOINTMENT_REMINDER_1H.email).toBe(true)
  })

  test('versão do futuro também é recusada', async () => {
    const dono = await makeCtx(biz)
    expect(stale(await domainError(updateSchedulingRules(dono, { bufferMin: 20 }, 9)))).toEqual(['conflict', 'stale_version'])
  })

  test('dono e admin gravam no mesmo lugar e a versão vale entre os dois: quem leu antes perde', async () => {
    const dono = await makeCtx(biz)
    // O dono abriu a tela na versão 1; o admin grava primeiro.
    await updateTerms(admin, biz.id, TERMOS, 1)
    expect(await versaoDasConfig()).toBe(2)
    expect(stale(await domainError(updateTermsAsOwner(dono, 1, { ...TERMOS, club: 'Dono' })))).toEqual(['conflict', 'stale_version'])
    // E o contrário: o dono grava, o admin com a versão antiga falha.
    await updateTermsAsOwner(dono, 2, { ...TERMOS, club: 'Dono' })
    expect(stale(await domainError(updateTerms(admin, biz.id, { ...TERMOS, club: 'Admin' }, 2)))).toEqual(['conflict', 'stale_version'])
    expect(stale(await domainError(updateRulesAsAdmin(admin, biz.id, { bufferMin: 5 }, 2)))).toEqual(['conflict', 'stale_version'])
    const avisos = { ...(await getNotificationSettingsView(dono)).settings, APPOINTMENT_REMINDER_1H: { email: false } }
    expect(stale(await domainError(updateNotificationsAsAdmin(admin, biz.id, avisos, 2)))).toEqual(['conflict', 'stale_version'])
  })

  test('regras do admin usam a mesma gravação do dono: auditoria com antes e depois, autor admin e versão', async () => {
    const r = await updateRulesAsAdmin(admin, biz.id, { slotStepMin: 30, bufferMin: 10 })
    expect(r.rules).toMatchObject({ slotStepMin: 30, bufferMin: 10, version: 2 })
    const [log] = await prisma.auditLog.findMany({ where: { businessId: biz.id, action: 'scheduling_rules.updated' } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, onBehalf: false })
    expect(log?.metadata).toMatchObject({
      fields: ['slotStepMin', 'bufferMin'],
      changes: { slotStepMin: { from: 15, to: 30 }, bufferMin: { from: 0, to: 10 } },
    })
  })

  test('versão antiga nas regras do admin: conflict e nada gravado', async () => {
    const e = await domainError(updateRulesAsAdmin(admin, biz.id, { bufferMin: 5 }, 7))
    expect(stale(e)).toEqual(['conflict', 'stale_version'])
    expect(await prisma.auditLog.count({ where: { businessId: biz.id } })).toBe(0)
    const ok = await updateRulesAsAdmin(admin, biz.id, { bufferMin: 5 }, 1)
    expect(ok.rules.version).toBe(2)
  })

  test('o dono não tem como mandar fuso por updateSchedulingRules', async () => {
    const dono = await makeCtx(biz)
    await updateSchedulingRules(dono, { timeZone: 'Asia/Tokyo', bufferMin: 5 } as never).catch(() => undefined)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: biz.id } })).timezone).toBe('America/Sao_Paulo')
  })

  test('gerente grava regras e avisos; profissional recebe forbidden', async () => {
    const gerente = await ctxWithRole(biz, 'MANAGER')
    expect((await updateSchedulingRules(gerente, { bufferMin: 5 }, 1)).version).toBe(2)
    const prof = await ctxWithRole(biz, 'PROFESSIONAL')
    expect((await domainError(updateSchedulingRules(prof, { bufferMin: 10 }, 2))).code).toBe('forbidden')
    expect((await domainError(updateNotificationSettings(prof, { APPOINTMENT_REMINDER_1H: { email: false } }, 2))).code).toBe('forbidden')
  })

  test('duas gravações com a mesma versão ao mesmo tempo: uma entra, a outra recebe stale_version', async () => {
    const dono = await makeCtx(biz)
    const r = await Promise.allSettled([
      updateSchedulingRules(dono, { bufferMin: 10 }, 1),
      updateSchedulingRules(dono, { bufferMin: 20 }, 1),
      updateTermsAsOwner(dono, 1, TERMOS),
    ])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    for (const x of r) if (x.status === 'rejected') expect(x.reason).toMatchObject({ code: 'conflict', reason: 'stale_version' })
    expect(await versaoDasConfig()).toBe(2)
  })

  test('módulos ganham versão que sobe só quando algo muda', async () => {
    const mods = { loyalty: true, banners: false, store: false }
    await updateModules(admin, biz.id, mods)
    await updateModules(admin, biz.id, mods)
    expect((await prisma.businessModules.findUniqueOrThrow({ where: { businessId: biz.id } })).version).toBe(2)
  })
})

describe('esquemas estritos', () => {
  test('avisos: tipo de aviso ou campo de canal desconhecido é recusado com validation', async () => {
    const ctx = await makeCtx(biz)
    const tipo = await domainError(updateNotificationSettings(ctx, { INEXISTENTE: { email: false } } as never))
    expect(tipo.code).toBe('validation')
    const canal = await domainError(updateNotificationSettings(ctx, { APPOINTMENT_CONFIRMED: { sms: true } } as never))
    expect(canal.code).toBe('validation')
    expect((await getNotificationSettingsView(ctx)).version).toBe(1)
  })
})
