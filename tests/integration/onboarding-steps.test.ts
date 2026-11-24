import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { createService } from '@/server/domain/catalog/services'
import { applyServiceSuggestions, getServiceSuggestions, inviteTeamFromOnboarding, setupOwnerSchedule } from '@/server/domain/onboarding/steps'
import { getOnboarding } from '@/server/domain/onboarding/progress'
import { getBusinessAppearance, updateBrandColors } from '@/server/domain/settings/business-profile'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeOnboarding, makeProfessional, makeService, makeUser, makeMembership } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const mail = fakeMail()
beforeEach(async () => {
  await resetDb()
  mail.install()
})
afterEach(() => mail.uninstall())

async function conta(servesCats = true) {
  const b = await makeBusiness({ niche: 'PET' })
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats } } })
  await makeOnboarding(b.id)
  return { b, dono: await ctxWithRole(b, 'OWNER') }
}

describe('serviços sugeridos', () => {
  test('sugestões: os cinco da spec, com a linha de gato só com servesCats', async () => {
    const { dono } = await conta(true)
    const r = await getServiceSuggestions(dono)
    expect(r.rows.map((x) => x.name)).toEqual(['Banho', 'Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha'])
    expect(r.rows[0]?.prices.map((p) => p.variant)).toEqual(['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT', 'CAT'])
    expect(r.rows[0]?.prices[0]).toEqual({ variant: 'DOG_SMALL', priceCents: 5000, durationMin: 60 })
    expect(r.rows.every((x) => !x.exists)).toBe(true)

    const sem = await conta(false)
    const r2 = await getServiceSuggestions(sem.dono)
    expect(r2.variants.map((v) => v.key)).not.toContain('CAT')
    expect(r2.rows[0]?.prices.map((p) => p.variant)).toEqual(['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT'])
  })

  test('as sugestões seguem a grade da conta e o que se cria passa depois pela tela de serviços (onGrid)', async () => {
    const { b, dono } = await conta()
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
    const { rows, slotStepMin } = await getServiceSuggestions(dono)
    expect(slotStepMin).toBe(30)
    expect(rows.every((r) => r.prices.every((p) => p.durationMin % 30 === 0))).toBe(true)
    await applyServiceSuggestions(dono, rows)
    const unha = await prisma.service.findFirstOrThrow({ where: { businessId: b.id, name: 'Corte de unha' }, include: { prices: true } })
    expect(unha.prices.every((p) => p.durationMin % 30 === 0)).toBe(true)
    const fora = rows[0]!
    await expect(applyServiceSuggestions(dono, [{ ...fora, name: 'Outro', prices: fora.prices.map((p) => ({ ...p, durationMin: 20 })) }])).rejects.toMatchObject({ code: 'validation' })
  })

  test('aplicar cria BY_VARIANT com as linhas enviadas e liga aos profissionais ativos', async () => {
    const { b, dono } = await conta()
    const ativo = await makeProfessional(b.id)
    const inativo = await makeProfessional(b.id, { active: false })
    const { rows } = await getServiceSuggestions(dono)
    const editado = { ...rows[0]!, prices: rows[0]!.prices.map((p) => (p.variant === 'DOG_SMALL' ? { ...p, priceCents: 5500 } : p)) }
    const r = await applyServiceSuggestions(dono, [editado, rows[4]!])
    expect(r).toEqual({ created: 2, skipped: 0 })
    const banho = await prisma.service.findFirstOrThrow({ where: { businessId: b.id, name: 'Banho' }, include: { prices: true } })
    expect(banho.pricingMode).toBe('BY_VARIANT')
    expect(banho.prices).toHaveLength(5)
    expect(banho.prices.find((p) => p.variant === 'DOG_SMALL')?.priceCents).toBe(5500)
    const ligados = await prisma.professionalService.findMany({ where: { serviceId: banho.id } })
    expect(ligados.map((l) => l.professionalId)).toEqual([ativo.id])
    expect(ligados.some((l) => l.professionalId === inativo.id)).toBe(false)
    expect((await getOnboarding(dono))?.steps.find((s) => s.key === 'SERVICES')?.status).toBe('done')
  })

  test('aplicar duas vezes (ou depois de criar Banho na tela de serviços): pula os que existem, nada duplica', async () => {
    const { b, dono } = await conta()
    const { rows } = await getServiceSuggestions(dono)
    await createService(dono, { name: 'banho', priceCents: 4000, durationMin: 30 })
    const r1 = await applyServiceSuggestions(dono, rows)
    expect(r1).toEqual({ created: 4, skipped: 1 })
    const r2 = await applyServiceSuggestions(dono, rows)
    expect(r2).toEqual({ created: 0, skipped: 5 })
    expect(await prisma.service.count({ where: { businessId: b.id } })).toBe(5)
    const [x, y] = await Promise.all([applyServiceSuggestions(dono, rows), applyServiceSuggestions(dono, rows)])
    expect(x.created + y.created).toBe(0)
  })

  test('envio duplo ao mesmo tempo numa loja vazia não duplica', async () => {
    const { b, dono } = await conta()
    const { rows } = await getServiceSuggestions(dono)
    const r = await Promise.all([applyServiceSuggestions(dono, rows), applyServiceSuggestions(dono, rows)])
    expect(r[0].created + r[1].created).toBe(5)
    expect(await prisma.service.count({ where: { businessId: b.id } })).toBe(5)
  })

  test('sugestão que já existe aparece com exists', async () => {
    const { b, dono } = await conta()
    await makeService(b.id, { name: 'Hidratação' })
    const r = await getServiceSuggestions(dono)
    expect(r.rows.filter((x) => x.exists).map((x) => x.name)).toEqual(['Hidratação'])
  })

  test('linha sem nenhum porte: validation com o nome do serviço; nada gravado', async () => {
    const { b, dono } = await conta()
    const { rows } = await getServiceSuggestions(dono)
    const e = await domainError(applyServiceSuggestions(dono, [rows[0]!, { ...rows[1]!, prices: [] }]))
    expect(e.code).toBe('validation')
    expect(e.message).toContain('Banho e tosa')
    expect(await prisma.service.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('só quem gere o catálogo aplica', async () => {
    const { b } = await conta()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(applyServiceSuggestions(prof, []))).code).toBe('forbidden')
  })
})

describe('expediente do dono', () => {
  test('setupOwnerSchedule cria a ficha do dono com os serviços e o expediente; repetir reaproveita a ficha', async () => {
    const { b, dono } = await conta()
    const s = await makeService(b.id)
    const r = await setupOwnerSchedule(dono, { attends: true })
    expect(r.professionalId).not.toBeNull()
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: r.professionalId! }, include: { services: true, workingHours: true } })
    expect(ficha.membershipId).toBe(dono.actor.kind === 'member' ? dono.actor.membershipId : '')
    expect(ficha.services.map((x) => x.serviceId)).toEqual([s.id])
    expect(ficha.workingHours).toHaveLength(6)
    const sabado = ficha.workingHours.find((h) => h.weekday === 'SATURDAY')
    expect([sabado?.startMin, sabado?.endMin]).toEqual([540, 780])

    const r2 = await setupOwnerSchedule(dono, { attends: true, schedule: { MONDAY: [{ startMin: 600, endMin: 720 }] } })
    expect(r2.professionalId).toBe(r.professionalId)
    expect(await prisma.professional.count({ where: { businessId: b.id } })).toBe(1)
    expect(await prisma.workingHours.count({ where: { professionalId: r.professionalId! } })).toBe(6)
    expect((await getOnboarding(dono))?.steps.find((x) => x.key === 'HOURS')?.status).toBe('done')
  })

  test('duas abas ao mesmo tempo não criam duas fichas', async () => {
    const { b, dono } = await conta()
    await Promise.allSettled([setupOwnerSchedule(dono, { attends: true }), setupOwnerSchedule(dono, { attends: true })])
    expect(await prisma.professional.count({ where: { businessId: b.id } })).toBe(1)
  })

  test('setupOwnerSchedule sem atender: nenhuma ficha e passo feito', async () => {
    const { b, dono } = await conta()
    const r = await setupOwnerSchedule(dono, { attends: false })
    expect(r.professionalId).toBeNull()
    expect(await prisma.professional.count({ where: { businessId: b.id } })).toBe(0)
    expect((await getOnboarding(dono))?.steps.find((x) => x.key === 'HOURS')?.status).toBe('done')
  })
})

describe('cores da marca', () => {
  test('updateBrandColors grava as cores com versão; versão velha: stale_version; cor inválida: validation', async () => {
    const { b, dono } = await conta()
    const a = await getBusinessAppearance(dono)
    const novo = await updateBrandColors(dono, a.version, { primary: '#1a2b3c', accent: '#ff8800' })
    expect(novo).toMatchObject({ primary: '#1A2B3C', accent: '#FF8800', version: a.version + 1 })
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'brand.updated' } })).toBe(1)

    const velha = await domainError(updateBrandColors(dono, a.version, { primary: '#000000', accent: '#FFFFFF' }))
    expect(velha.reason).toBe('stale_version')
    const ruim = await domainError(updateBrandColors(dono, novo.version, { primary: 'azul', accent: '#FFFFFF' }))
    expect(ruim.code).toBe('validation')

    // sem mudança: não sobe a versão nem audita
    const igual = await updateBrandColors(dono, novo.version, { primary: '#1A2B3C', accent: '#FF8800' })
    expect(igual.version).toBe(novo.version)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'brand.updated' } })).toBe(1)
  })

  test('gerente não muda as cores', async () => {
    const { b } = await conta()
    const gerente = await ctxWithRole(b, 'MANAGER')
    expect((await domainError(updateBrandColors(gerente, 1, { primary: '#000000', accent: '#FFFFFF' }))).code).toBe('forbidden')
  })
})

describe('equipe', () => {
  test('convites: um repetido vira erro da linha e os outros são enviados', async () => {
    const { b, dono } = await conta()
    const ja = await makeUser({ email: 'ja@exemplo.test' })
    await makeMembership(b.id, ja.id, 'PROFESSIONAL')
    const r = await inviteTeamFromOnboarding(dono, [
      { name: 'Ana', email: 'ana@exemplo.test', role: 'PROFESSIONAL' },
      { name: 'Já', email: 'ja@exemplo.test', role: 'PROFESSIONAL' },
      { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' },
    ])
    expect(r.invited).toBe(2)
    expect(r.errors).toEqual({ 1: 'Esta pessoa já está na equipe.' })
    expect((await getOnboarding(dono))?.steps.find((x) => x.key === 'TEAM')?.status).toBe('done')
  })

  test('nenhuma enviada não marca o passo; mais de cinco é recusado', async () => {
    const { dono } = await conta()
    const r = await inviteTeamFromOnboarding(dono, [{ name: 'X', email: 'invalido', role: 'PROFESSIONAL' }])
    expect(r.invited).toBe(0)
    expect(Object.keys(r.errors)).toEqual(['0'])
    expect((await getOnboarding(dono))?.steps.find((x) => x.key === 'TEAM')?.status).toBe('todo')
    const seis = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, email: `p${i}@exemplo.test`, role: 'PROFESSIONAL' as const }))
    expect((await domainError(inviteTeamFromOnboarding(dono, seis))).code).toBe('validation')
  })
})
