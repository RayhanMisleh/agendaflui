import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { env } from '@/server/env'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin, makeUser } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
const envio = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }))
vi.mock('@/server/notifications/channels', async (original) => {
  const real = await original<typeof import('@/server/notifications/channels')>()
  return { ...real, getEmailChannel: () => envio }
})
const falhas = vi.hoisted(() => ({ regrasFalham: false }))
vi.mock('@/server/domain/platform/customization', async (original) => {
  const real = await original<typeof import('@/server/domain/platform/customization')>()
  const { DomainError } = await import('@/server/domain/errors')
  return {
    ...real,
    updateRulesAsAdmin: (...args: Parameters<typeof real.updateRulesAsAdmin>) => {
      if (falhas.regrasFalham) throw new DomainError('validation', 'Motivo claro do domínio.')
      return real.updateRulesAsAdmin(...args)
    },
  }
})
import { criarConta } from '@/app/dev/(app)/contas/nova/actions'
import { EMPTY_VALUES, type WizardData } from '@/app/dev/(app)/contas/nova/fields'
import type { FormState } from '@/app/_lib/form-state'

const inicial: FormState<WizardData> = { ok: false, message: null, fields: {}, values: EMPTY_VALUES }

function formulario(extra: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    name: 'Pata Viva',
    slug: 'pata-viva',
    document: '',
    contactEmail: '',
    contactPhone: '',
    displayName: 'Pata Viva Pet Shop',
    primary: '#2f6b4f',
    accent: '#E8833A',
    material: 'LINEN',
    professionalSingular: 'Tosador',
    professionalPlural: 'Tosadores',
    customerSingular: 'Tutor',
    customerPlural: 'Tutores',
    pointsSingular: 'Patinha',
    pointsPlural: 'Patinhas',
    club: 'Clube Pata',
    loyalty: 'on',
    store: 'on',
    slotStepMin: '30',
    minLeadMin: '90',
    maxAdvanceDays: '45',
    customerChangeWindowMin: '180',
    bufferMin: '10',
    autoConfirm: 'on',
    ownerName: 'Marina Duarte',
    ownerEmail: 'marina@exemplo.test',
  }
  const fd = new FormData()
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== '__ausente__') fd.set(k, v)
  return fd
}

async function redirecionamento(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const digest = (e as { digest?: string }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? ''
    throw e
  }
  throw new Error('Era esperado um redirecionamento.')
}

beforeEach(async () => {
  await resetDb()
  falhas.regrasFalham = false
  envio.send.mockClear()
  const admin = await makePlatformAdmin()
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: admin.id, name: admin.name })
})
afterEach(() => {
  guards.requirePlatformAdmin.mockReset()
})

describe('criar conta pela ação do assistente', () => {
  test('com dados válidos cria conta, marca, termos, módulos, regras e dono', async () => {
    const estado = await criarConta(inicial, formulario())
    expect(estado.ok).toBe(true)
    const r = estado.values.result
    expect(r?.pendencias).toEqual([])
    expect(r).not.toHaveProperty('entryUrl')
    expect(r?.customerLinkUrl).toBe(`http://${env.APP_HOST}/pata-viva`)

    const conta = await prisma.business.findUniqueOrThrow({
      where: { slug: 'pata-viva' },
      include: { branding: true, settings: true, modules: true, memberships: { include: { user: true } } },
    })
    expect(conta.id).toBe(r?.createdId)
    expect(conta.branding?.displayName).toBe('Pata Viva Pet Shop')
    expect(conta.branding?.primaryColor).toBe('#2F6B4F')
    expect(conta.branding?.coverMaterial).toBe('LINEN')
    expect(conta.settings?.termProfessionalSingular).toBe('Tosador')
    expect(conta.settings?.termClub).toBe('Clube Pata')
    expect(conta.settings?.slotStepMin).toBe(30)
    expect(conta.settings?.bufferMin).toBe(10)
    expect(conta.modules).toMatchObject({ loyalty: true, banners: false, store: true })
    expect(conta.memberships.map((m) => [m.role, m.user.email])).toEqual([['OWNER', 'marina@exemplo.test']])
    expect(envio.send).toHaveBeenCalledTimes(1)
  })

  test('erro de validação devolve o estado sem senha nem segredo nos valores', async () => {
    const estado = await criarConta(inicial, formulario({ slug: 'a' }))
    expect(estado.ok).toBe(false)
    expect(JSON.stringify(estado)).not.toMatch(/afk_|hunter2/)
  })

  test('slug duplicado devolve o erro no campo slug, e a etapa dele é a primeira', async () => {
    await makeBusiness({ slug: 'pata-viva' })
    const estado = await criarConta(inicial, formulario())
    expect(estado.ok).toBe(false)
    expect(estado.fields.slug).toMatch(/Já existe uma conta/)
    expect(estado.values.slug).toBe('pata-viva')
    expect(estado.values.ownerName).toBe('Marina Duarte')
    const { firstStepWithError } = await import('@/app/dev/(app)/contas/nova/fields')
    expect(firstStepWithError(estado.fields)).toBe(0)
  })

  test('erro de outra etapa (cor, termo, regra) é recusado ANTES de criar a conta, no campo certo', async () => {
    const casos: Array<[Record<string, string>, string]> = [
      [{ primary: 'vermelho' }, 'primary'],
      [{ club: '' }, 'club'],
      [{ slotStepMin: '7' }, 'slotStepMin'],
      [{ ownerEmail: 'sem-arroba' }, 'ownerEmail'],
    ]
    for (const [extra, campo] of casos) {
      const estado = await criarConta(inicial, formulario(extra))
      expect(estado.ok, campo).toBe(false)
      expect(Object.keys(estado.fields), campo).toContain(campo)
    }
    expect(await prisma.business.count()).toBe(0)
  })

  test('dono que já existe: vincula, não troca a senha e a conta é criada', async () => {
    const existente = await makeUser({ email: 'marina@exemplo.test' })
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: existente.id } })
    const estado = await criarConta(inicial, formulario())
    expect(estado.ok).toBe(true)
    expect(estado.values.result?.ownerExisting).toBe(true)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: existente.id } })
    expect(depois.passwordHash).toBe(antes.passwordHash)
  })

  test('passo depois da criação que falha redireciona para a página da conta com o código do que faltou', async () => {
    falhas.regrasFalham = true
    const destino = await redirecionamento(criarConta(inicial, formulario()))
    const conta = await prisma.business.findUniqueOrThrow({ where: { slug: 'pata-viva' } })
    expect(destino).toBe(`/contas/${conta.id}?faltou=regras`)
  })

  test('um arquivo de logo no formulário é ignorado: a imagem vai pela rota própria, depois de a conta existir', async () => {
    const fd = formulario()
    fd.set('logo', new File(['x'], 'logo.png', { type: 'image/png' }))
    const estado = await criarConta(inicial, fd)
    expect(estado.ok).toBe(true)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('sem sessão de admin não cria nada', async () => {
    guards.requirePlatformAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarConta(inicial, formulario())).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.business.count()).toBe(0)
    expect(await prisma.user.count()).toBe(0)
  })
})
