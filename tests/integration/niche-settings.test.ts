import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { getNicheSettings, updateNicheOptions } from '@/server/domain/settings/niche-settings'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness } from '../setup/factories'

beforeEach(async () => {
  await resetDb()
})

describe('nicho e opções da conta', () => {
  test('conta sem nicho: niche null e opções padrão', async () => {
    const b = await makeBusiness()
    const ctx = await ctxWithRole(b, 'OWNER')
    const s = await getNicheSettings(ctx)
    expect(s.niche).toBeNull()
    expect(s.options).toEqual({ servesCats: false })
  })

  test('conta pet: lê servesCats gravado; JSON inválido gravado vira padrão sem quebrar', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const ctx = await ctxWithRole(b, 'OWNER')
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
    expect((await getNicheSettings(ctx)).options).toEqual({ servesCats: true })
    expect((await getNicheSettings(ctx)).niche?.key).toBe('PET')
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: 'talvez' } } })
    expect((await getNicheSettings(ctx)).options).toEqual({ servesCats: false })
  })

  test('updateNicheOptions liga gatos, sobe a versão e audita', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const ctx = await ctxWithRole(b, 'OWNER')
    const antes = await getNicheSettings(ctx)
    const r = await updateNicheOptions(ctx, { servesCats: true, version: antes.version })
    expect(r.options.servesCats).toBe(true)
    expect(r.version).toBe(antes.version + 1)
    const linha = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: b.id } })
    expect(linha.nicheOptions).toEqual({ servesCats: true })
    expect(linha.version).toBe(antes.version + 1)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId: b.id, action: 'settings.niche_options_updated' } })
    expect(log.metadata).toEqual({ servesCats: true })
  })

  test('sem mudança: não sobe a versão nem audita', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const ctx = await ctxWithRole(b, 'OWNER')
    const antes = await getNicheSettings(ctx)
    const r = await updateNicheOptions(ctx, { servesCats: false })
    expect(r.version).toBe(antes.version)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'settings.niche_options_updated' } })).toBe(0)
  })

  test('updateNicheOptions com versão velha → conflict stale_version', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const ctx = await ctxWithRole(b, 'OWNER')
    const antes = await getNicheSettings(ctx)
    await updateNicheOptions(ctx, { servesCats: true, version: antes.version })
    await expect(updateNicheOptions(ctx, { servesCats: false, version: antes.version })).rejects.toMatchObject({ code: 'conflict', reason: 'stale_version' })
  })

  test('profissional não altera (forbidden); gerente altera', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const gerente = await ctxWithRole(b, 'MANAGER')
    await expect(updateNicheOptions(prof, { servesCats: true })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await updateNicheOptions(gerente, { servesCats: true })).options.servesCats).toBe(true)
  })

  test('conta sem nicho: updateNicheOptions → niche_unavailable', async () => {
    const b = await makeBusiness()
    const ctx = await ctxWithRole(b, 'OWNER')
    await expect(updateNicheOptions(ctx, { servesCats: true })).rejects.toMatchObject({ code: 'conflict', reason: 'niche_unavailable' })
  })

  test('getPainelContext traz o nicho da conta pet e null sem nicho', async () => {
    const pet = await makeBusiness({ niche: 'PET' })
    const ctxPet = await ctxWithRole(pet, 'OWNER')
    await updateNicheOptions(ctxPet, { servesCats: true })
    expect((await getPainelContext(ctxPet)).niche).toEqual({ key: 'PET', label: 'Pet shop', servesCats: true })
    const sem = await makeBusiness()
    expect((await getPainelContext(await ctxWithRole(sem, 'OWNER'))).niche).toBeNull()
  })
})
