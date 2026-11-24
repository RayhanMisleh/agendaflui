import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { createBusiness } from '@/server/domain/platform/businesses'
import {
  dismissOnboarding,
  finishOnboardingWizard,
  getOnboarding,
  markOnboardingStep,
  ONBOARDING_STEPS,
  shouldRedirectToOnboarding,
} from '@/server/domain/onboarding/progress'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeOnboarding, makePlatformAdmin, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

beforeEach(resetDb)

async function contaPet() {
  const b = await makeBusiness({ niche: 'PET' })
  await makeOnboarding(b.id)
  return { b, dono: await ctxWithRole(b, 'OWNER') }
}

describe('criação e leitura', () => {
  test('createBusiness cria o progresso vazio; conta sem linha não tem começo (getOnboarding null)', async () => {
    const admin = await makePlatformAdmin()
    const actor: Extract<Actor, { kind: 'platform_admin' }> = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
    const r = await createBusiness(actor, { name: 'Pet Novo', slug: 'pet-novo', niche: 'PET', owner: { name: 'Dona', email: 'dona@exemplo.test' } })
    const linha = await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: r.business.id } })
    expect(linha).toMatchObject({ doneSteps: [], skippedSteps: [], wizardFinishedAt: null, completedAt: null, dismissedAt: null })

    const velha = await makeBusiness({ niche: 'PET' })
    expect(await getOnboarding(await ctxWithRole(velha, 'OWNER'))).toBeNull()
  })

  test('ordem e rótulos; sem nicho o passo Animais some', async () => {
    const { dono } = await contaPet()
    const v = await getOnboarding(dono)
    expect(v?.steps.map((s) => s.label)).toEqual(['Dados da loja', 'Marca', 'Animais atendidos', 'Serviços', 'Expediente', 'Equipe', 'Link para clientes'])
    expect(v?.steps.map((s) => s.slug)).toEqual(ONBOARDING_STEPS.map((s) => s.slug))
    expect(v).toMatchObject({ done: 0, total: 7, current: 'STORE' })

    const sem = await makeBusiness()
    await makeOnboarding(sem.id)
    const v2 = await getOnboarding(await ctxWithRole(sem, 'OWNER'))
    expect(v2?.total).toBe(6)
    expect(v2?.steps.some((s) => s.key === 'ANIMALS')).toBe(false)
  })
})

describe('marcas', () => {
  test('marcar feito tira de pulados; pular não rebaixa um feito', async () => {
    const { b, dono } = await contaPet()
    await markOnboardingStep(dono, 'BRAND', 'skipped')
    expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).skippedSteps).toEqual(['BRAND'])
    await markOnboardingStep(dono, 'BRAND', 'done')
    await markOnboardingStep(dono, 'BRAND', 'skipped')
    const linha = await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })
    expect(linha.doneSteps).toEqual(['BRAND'])
    expect(linha.skippedSteps).toEqual([])
  })

  test('pulados contam como não feitos e vêm depois dos pendentes em current', async () => {
    const { dono } = await contaPet()
    await markOnboardingStep(dono, 'STORE', 'skipped')
    const v = await getOnboarding(dono)
    expect(v?.done).toBe(0)
    expect(v?.current).toBe('BRAND')
    expect(v?.steps[0]?.status).toBe('skipped')
  })

  test('dois envios do mesmo passo e duas abas marcando passos diferentes: as marcas se juntam, sem erro', async () => {
    const { b, dono } = await contaPet()
    await Promise.all([
      markOnboardingStep(dono, 'STORE', 'done'),
      markOnboardingStep(dono, 'STORE', 'done'),
      markOnboardingStep(dono, 'BRAND', 'done'),
      markOnboardingStep(dono, 'ANIMALS', 'done'),
    ])
    const linha = await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })
    expect([...linha.doneSteps].sort()).toEqual(['ANIMALS', 'BRAND', 'STORE'])
  })

  test('Serviços e Expediente contam como feitos pelo que já existe na loja', async () => {
    const { b, dono } = await contaPet()
    await makeService(b.id)
    const prof = await makeProfessional(b.id)
    await makeWorkingHours(b.id, prof.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
    const v = await getOnboarding(dono)
    expect(v?.steps.find((s) => s.key === 'SERVICES')?.status).toBe('done')
    expect(v?.steps.find((s) => s.key === 'HOURS')?.status).toBe('done')
    expect(v?.done).toBe(2)
  })

  test('passos que passam a valer pelo que existe na loja concluem o começo ao ler (nada mais marcaria completedAt)', async () => {
    const { b, dono } = await contaPet()
    for (const k of ['STORE', 'BRAND', 'ANIMALS', 'TEAM', 'LINK'] as const) await markOnboardingStep(dono, k, 'done')
    await markOnboardingStep(dono, 'SERVICES', 'skipped')
    await markOnboardingStep(dono, 'HOURS', 'skipped')
    expect((await getOnboarding(dono))?.completed).toBe(false)
    await makeService(b.id)
    const prof = await makeProfessional(b.id)
    await makeWorkingHours(b.id, prof.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
    const versao = (await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).version
    const v = await getOnboarding(dono)
    expect(v?.completed).toBe(true)
    expect(v?.completedAt).not.toBeNull()
    // Ler não muda a versão: um formulário aberto com a versão lida não pode dar conflito por causa de uma leitura.
    expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).version).toBe(versao)
    await markOnboardingStep(dono, 'STORE', 'done')
    expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).completedAt).not.toBeNull()
  })

  test('serviço arquivado ou profissional arquivado não contam', async () => {
    const { b, dono } = await contaPet()
    await makeService(b.id, { archivedAt: new Date() })
    const prof = await makeProfessional(b.id, { archivedAt: new Date() })
    await makeWorkingHours(b.id, prof.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
    expect((await getOnboarding(dono))?.done).toBe(0)
  })

  test('todos feitos: completedAt preenchido', async () => {
    const { b, dono } = await contaPet()
    for (const s of ['STORE', 'BRAND', 'ANIMALS', 'SERVICES', 'HOURS', 'TEAM']) {
      await markOnboardingStep(dono, s as 'STORE', 'done')
      expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).completedAt).toBeNull()
    }
    const v = await markOnboardingStep(dono, 'LINK', 'done')
    expect(v).toMatchObject({ done: 7, current: null, completed: true })
    expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId: b.id } })).completedAt).not.toBeNull()
  })
})

describe('redirecionamento e permissões', () => {
  test('shouldRedirect: dono sim; gerente, profissional e suporte não; depois de terminar ou dispensar não', async () => {
    const { b, dono } = await contaPet()
    expect(await shouldRedirectToOnboarding(dono)).toBe(true)
    expect(await shouldRedirectToOnboarding(await ctxWithRole(b, 'MANAGER'))).toBe(false)
    expect(await shouldRedirectToOnboarding(await ctxWithRole(b, 'PROFESSIONAL'))).toBe(false)
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    expect(await shouldRedirectToOnboarding(suporte)).toBe(false)

    await finishOnboardingWizard(dono)
    expect(await shouldRedirectToOnboarding(dono)).toBe(false)

    const c = await contaPet()
    await dismissOnboarding(c.dono)
    expect(await shouldRedirectToOnboarding(c.dono)).toBe(false)
    expect((await getOnboarding(c.dono))?.dismissed).toBe(true)
  })

  test('terminar e dispensar são idempotentes e gravam uma auditoria só', async () => {
    const { b, dono } = await contaPet()
    await finishOnboardingWizard(dono)
    await finishOnboardingWizard(dono)
    await dismissOnboarding(dono)
    await dismissOnboarding(dono)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'onboarding.finished' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'onboarding.dismissed' } })).toBe(1)
  })

  test('conta sem linha: não redireciona e marcar falha com not_found', async () => {
    const b = await makeBusiness({ niche: 'PET' })
    const dono = await ctxWithRole(b, 'OWNER')
    expect(await shouldRedirectToOnboarding(dono)).toBe(false)
    expect((await domainError(markOnboardingStep(dono, 'STORE', 'done'))).code).toBe('not_found')
  })

  test('gerente não lê nem marca (null / forbidden)', async () => {
    const { b } = await contaPet()
    const gerente = await ctxWithRole(b, 'MANAGER')
    expect(await getOnboarding(gerente)).toBeNull()
    expect((await domainError(markOnboardingStep(gerente, 'STORE', 'done'))).code).toBe('forbidden')
    expect((await domainError(dismissOnboarding(gerente))).code).toBe('forbidden')
  })
})

describe('schema', () => {
  test('done e skipped não se cruzam (onboarding_progress_steps_disjoint)', async () => {
    const b = await makeBusiness()
    await expect(makeOnboarding(b.id, { doneSteps: ['STORE'], skippedSteps: ['STORE'] })).rejects.toThrow(/onboarding_progress_steps_disjoint/)
  })
})
