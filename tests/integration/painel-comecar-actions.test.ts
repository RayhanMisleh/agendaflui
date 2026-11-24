import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { getOnboarding } from '@/server/domain/onboarding/progress'
import { getServiceSuggestions } from '@/server/domain/onboarding/steps'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeOnboarding } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import { convidarEquipe, dispensar, pularPasso, salvarAnimais, salvarExpediente, salvarLoja, salvarServicos, terminar } from '@/app/app/painel/comecar/actions'
import InicioPage from '@/app/app/painel/page'
import ComecarPage from '@/app/app/painel/comecar/page'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const mail = fakeMail()

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  const b = await makeBusiness({ niche: 'PET' })
  businessId = b.id
  await prisma.businessSettings.update({ where: { businessId }, data: { nicheOptions: { servesCats: true } } })
  await makeOnboarding(businessId)
  dono = await ctxWithRole(b, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
  mail.install()
})
afterEach(() => {
  guards.requireTenant.mockReset()
  mail.uninstall()
})

/** O formulário da tela de serviços como a pessoa o enviaria: todas as sugestões marcadas, salvo as de `fora`. */
async function formServicos(fora: string[] = [], extras: Record<string, string> = {}): Promise<FormData> {
  const { rows } = await getServiceSuggestions(dono)
  const c: Record<string, string> = { n: String(rows.length) }
  rows.forEach((r, i) => {
    if (!fora.includes(r.name)) c[`s_${i}_on`] = 'on'
    c[`s_${i}_name`] = r.name
    c[`s_${i}_icon`] = r.icon
    c[`s_${i}_desc`] = r.description ?? ''
    for (const p of r.prices) {
      c[`s_${i}_${p.variant}_price`] = (p.priceCents / 100).toFixed(2).replace('.', ',')
      c[`s_${i}_${p.variant}_duration`] = String(p.durationMin)
    }
  })
  return form({ ...c, ...extras })
}

describe('Início e redirecionamento', () => {
  test('dono no Início com começo aberto é redirecionado para /painel/comecar; depois de terminar não', async () => {
    await expect(InicioPage()).rejects.toThrow('NEXT_REDIRECT /painel/comecar')
    await expect(terminar(ini, form({}))).rejects.toThrow('NEXT_REDIRECT /painel')
    await expect(InicioPage()).resolves.toBeTruthy()
  })

  test('suporte e gerente no Início não são redirecionados', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    await expect(InicioPage()).resolves.toBeTruthy()
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    await expect(InicioPage()).resolves.toBeTruthy()
  })

  test('dispensar para o redirecionamento e some a lista do Início', async () => {
    await expect(dispensar(ini, form({}))).rejects.toThrow('NEXT_REDIRECT /painel')
    await expect(InicioPage()).resolves.toBeTruthy()
    expect((await getOnboarding(dono))?.dismissed).toBe(true)
    expect(await prisma.auditLog.count({ where: { businessId, action: 'onboarding.dismissed' } })).toBe(1)
  })

  test('gerente abrindo /painel/comecar recebe 404', async () => {
    const gerente = await ctxWithRole({ id: businessId }, 'MANAGER')
    guards.requireTenant.mockImplementation(async (capacidade?: string) => {
      const { notFound } = await import('next/navigation')
      const { can } = await import('@/server/auth/capabilities')
      if (capacidade && !can(gerente.actor, capacidade as 'manage_account')) notFound()
      return gerente
    })
    await expect(ComecarPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    expect(guards.requireTenant).toHaveBeenCalledWith('manage_account')
  })

  test('a tela abre no passo atual e aceita ?passo= de outro', async () => {
    const r = await ComecarPage({ searchParams: Promise.resolve({ passo: 'servicos' }) })
    expect(r).toBeTruthy()
    const sem = await makeBusiness()
    guards.requireTenant.mockResolvedValue(await ctxWithRole(sem, 'OWNER'))
    await expect(ComecarPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT /painel')
  })
})

describe('passos', () => {
  test('salvarLoja grava, marca feito e vai para a marca', async () => {
    const v = (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).version
    await expect(salvarLoja(ini, form({ version: String(v), name: 'Focinho Feliz', contactEmail: 'oi@exemplo.test', contactPhone: '(11) 91234-5678' }))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=marca')
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId } })).displayName).toBe('Focinho Feliz')
    expect((await getOnboarding(dono))?.steps[0]?.status).toBe('done')
  })

  test('pularPasso marca skipped e avança; voltar ao passo pulado e salvar marca done', async () => {
    await expect(pularPasso(ini, form({ passo: 'STORE' }))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=marca')
    expect((await getOnboarding(dono))?.steps[0]?.status).toBe('skipped')
    const v = (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).version
    await expect(salvarLoja(ini, form({ version: String(v), name: 'Outro nome' }))).rejects.toThrow('NEXT_REDIRECT')
    expect((await getOnboarding(dono))?.steps[0]?.status).toBe('done')
  })

  test('pularPasso com passo inexistente vira erro de formulário', async () => {
    const r = await pularPasso(ini, form({ passo: 'XYZ' }))
    expect(r.ok).toBe(false)
  })

  test('salvarAnimais liga os gatos e segue para serviços', async () => {
    const v = (await prisma.businessSettings.findUniqueOrThrow({ where: { businessId } })).version
    await expect(salvarAnimais(ini, form({ version: String(v) }))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=servicos')
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { businessId } })).nicheOptions).toEqual({ servesCats: false })
  })

  test('salvarServicos cria os marcados com a tabela enviada e vai para expediente', async () => {
    await expect(salvarServicos(ini, await formServicos(['Hidratação', 'Corte de unha']))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=expediente')
    const servicos = await prisma.service.findMany({ where: { businessId }, include: { prices: true }, orderBy: { displayOrder: 'asc' } })
    expect(servicos.map((s) => s.name)).toEqual(['Banho', 'Banho e tosa', 'Tosa higiênica'])
    expect(servicos[0]?.prices).toHaveLength(5)
    expect(servicos[0]?.pricingMode).toBe('BY_VARIANT')
    expect((await getOnboarding(dono))?.steps.find((s) => s.key === 'SERVICES')?.status).toBe('done')
  })

  test('salvarServicos reenviado (duplo clique) não duplica', async () => {
    await expect(salvarServicos(ini, await formServicos())).rejects.toThrow('NEXT_REDIRECT')
    await expect(salvarServicos(ini, await formServicos())).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.service.count({ where: { businessId } })).toBe(5)
  })

  test('salvarServicos: porte sem preço fica de fora, linha sem preço nenhum e preço inválido voltam como erro de campo', async () => {
    const fd = await formServicos(['Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha'])
    fd.set('s_0_CAT_price', '')
    await expect(salvarServicos(ini, fd)).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.servicePrice.count({ where: { businessId } })).toBe(4)

    const ruim = await formServicos(['Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha'])
    ruim.set('s_0_DOG_SMALL_price', 'abc')
    const r = await salvarServicos(ini, ruim)
    expect(r.ok).toBe(false)
    expect(r.fields.s_0_DOG_SMALL_price).toBeTruthy()

    const vazia = await formServicos(['Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha'])
    for (const k of ['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT', 'CAT']) vazia.set(`s_0_${k}_price`, '')
    const r2 = await salvarServicos(ini, vazia)
    expect(r2.fields.s_0_name).toContain('pelo menos um porte')
    const nenhum = await salvarServicos(ini, await formServicos(['Banho', 'Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha']))
    expect(nenhum.ok).toBe(false)
    expect(nenhum.message).toContain('Marque pelo menos um serviço')
  })

  test('salvarExpediente com "sim" cria a ficha e o expediente; com "não" só avança', async () => {
    await expect(
      salvarExpediente(ini, form({ attends: 'sim', 'MONDAY.0.start': '09:00', 'MONDAY.0.end': '12:00', 'TUESDAY.0.start': '13:00', 'TUESDAY.0.end': '18:00' })),
    ).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=equipe')
    expect(await prisma.professional.count({ where: { businessId } })).toBe(1)
    expect(await prisma.workingHours.count({ where: { businessId } })).toBe(2)
    const ruim = await salvarExpediente(ini, form({ attends: 'sim', 'MONDAY.0.start': 'xx', 'MONDAY.0.end': '12:00' }))
    expect(ruim.ok).toBe(false)
    expect(ruim.fields['MONDAY.0.start']).toBeTruthy()
    await expect(salvarExpediente(ini, form({ attends: 'nao' }))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=equipe')
    expect(await prisma.professional.count({ where: { businessId } })).toBe(1)
  })

  test('convidarEquipe: tudo certo vai para o link; erro numa linha mantém só ela no formulário', async () => {
    await expect(convidarEquipe(ini, form({ n: '2', t_0_name: 'Ana', t_0_email: 'ana@exemplo.test', t_0_role: 'PROFESSIONAL', t_1_name: '', t_1_email: '' }))).rejects.toThrow('NEXT_REDIRECT /painel/comecar?passo=link')
    const r = await convidarEquipe(ini, form({ n: '2', t_0_name: 'Ana', t_0_email: 'ana@exemplo.test', t_0_role: 'PROFESSIONAL', t_1_name: 'Bia', t_1_email: 'bia@exemplo.test', t_1_role: 'MANAGER' }))
    expect(r.ok).toBe(false)
    expect(r.fields.t_0_email).toBe('Esta pessoa já está na equipe.')
    expect(r.values.t_1_email).toBe('')
    expect(r.values.t_0_email).toBe('ana@exemplo.test')
    expect(r.message).toContain('1 convite enviado')
    const vazio = await convidarEquipe(ini, form({ n: '1', t_0_name: '', t_0_email: '' }))
    expect(vazio.message).toContain('pelo menos uma pessoa')
  })

  test('terminar marca o link e encerra o passo a passo', async () => {
    await expect(terminar(ini, form({}))).rejects.toThrow('NEXT_REDIRECT /painel')
    const linha = await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId } })
    expect(linha.doneSteps).toContain('LINK')
    expect(linha.wizardFinishedAt).not.toBeNull()
  })

  test('gerente chamando a ação recebe "sem permissão" e nada muda', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    const r = await dispensar(ini, form({}))
    expect(r.ok).toBe(false)
    expect((await prisma.onboardingProgress.findUniqueOrThrow({ where: { businessId } })).dismissedAt).toBeNull()
  })
})
