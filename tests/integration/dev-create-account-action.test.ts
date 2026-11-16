import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin, makeUser } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
const envio = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }))
vi.mock('@/server/notifications/channels', async (original) => {
  const real = await original<typeof import('@/server/notifications/channels')>()
  return { ...real, getEmailChannel: () => envio }
})
const disco = vi.hoisted(() => ({ storage: null as import('@/server/storage/storage').Storage | null }))
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco.storage ?? real.getStorage() }
})
const chaves = vi.hoisted(() => ({ falhar: false }))
vi.mock('@/server/domain/platform/api-keys', async (original) => {
  const real = await original<typeof import('@/server/domain/platform/api-keys')>()
  return {
    ...real,
    createApiKey: (...args: Parameters<typeof real.createApiKey>) => {
      if (chaves.falhar) throw new Error('banco indisponível; senha=hunter2')
      return real.createApiKey(...args)
    },
  }
})

import { criarConta } from '@/app/dev/(app)/contas/nova/actions'
import { EMPTY_VALUES, type WizardData } from '@/app/dev/(app)/contas/nova/fields'
import type { FormState } from '@/app/dev/(app)/_lib/form-state'

const inicial: FormState<WizardData> = { ok: false, message: null, fields: {}, values: EMPTY_VALUES }

function formulario(extra: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    name: 'Pata Viva',
    slug: 'pata-viva',
    timeZone: 'America/Sao_Paulo',
    legalName: '',
    document: '',
    contactEmail: '',
    contactPhone: '',
    internalNotes: '',
    displayName: 'Pata Viva Pet Shop',
    primary: '#2f6b4f',
    accent: '#E8833A',
    material: 'LINEN',
    paper: 'CREAM',
    fontPair: 'FRIENDLY',
    loginMessage: 'Bem-vindo de volta.',
    professionalSingular: 'Tosador',
    professionalPlural: 'Tosadores',
    customerSingular: 'Tutor',
    customerPlural: 'Tutores',
    pointsSingular: 'Patinha',
    pointsPlural: 'Patinhas',
    club: 'Clube Pata',
    loyalty: 'on',
    store: 'on',
    vouchers: 'on',
    slotStepMin: '30',
    minLeadMin: '90',
    maxAdvanceDays: '45',
    customerChangeWindowMin: '180',
    bufferMin: '10',
    autoConfirm: 'on',
    ownerName: 'Marina Duarte',
    ownerEmail: 'marina@exemplo.test',
    createKey: 'on',
    keyName: 'App Pata Viva',
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

let dir: string
beforeAll(async () => {
  const { createLocalDiskStorage } = await import('@/server/storage/local-disk')
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-wizard-'))
  disco.storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetDb()
  chaves.falhar = false
  envio.send.mockClear()
  const admin = await makePlatformAdmin()
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: admin.id, name: admin.name })
})
afterEach(() => {
  guards.requirePlatformAdmin.mockReset()
})

describe('criar conta pela ação do assistente', () => {
  test('com dados válidos cria conta, marca, termos, módulos, regras, dono e chave; o segredo volta uma vez no estado', async () => {
    const estado = await criarConta(inicial, formulario())
    expect(estado.ok).toBe(true)
    const r = estado.values.result
    expect(r?.pendencias).toEqual([])
    expect(r?.secret).toMatch(/^afk_a_/)
    expect(r?.entryUrl).toContain('/entrar/pata-viva')

    const conta = await prisma.business.findUniqueOrThrow({
      where: { slug: 'pata-viva' },
      include: { branding: true, settings: true, modules: true, memberships: { include: { user: true } } },
    })
    expect(conta.id).toBe(r?.createdId)
    expect(conta.branding?.displayName).toBe('Pata Viva Pet Shop')
    expect(conta.branding?.primaryColor).toBe('#2F6B4F')
    expect(conta.branding?.coverMaterial).toBe('LINEN')
    expect(conta.branding?.paperTone).toBe('CREAM')
    expect(conta.settings?.termProfessionalSingular).toBe('Tosador')
    expect(conta.settings?.termClub).toBe('Clube Pata')
    expect(conta.settings?.slotStepMin).toBe(30)
    expect(conta.settings?.bufferMin).toBe(10)
    expect(conta.modules).toMatchObject({ loyalty: true, banners: false, store: true, vouchers: true })
    expect(conta.memberships.map((m) => [m.role, m.user.email])).toEqual([['OWNER', 'marina@exemplo.test']])
    const chave = await prisma.apiKey.findFirstOrThrow({ where: { businessId: conta.id } })
    expect(chave.name).toBe('App Pata Viva')
    expect(chave.kind).toBe('ACCOUNT')
    // O segredo não fica no banco em texto: só o hash.
    expect(JSON.stringify(chave)).not.toContain(r?.secret ?? 'x')
    expect(envio.send).toHaveBeenCalledTimes(1)
  })

  test('o segredo não volta se o estado for devolvido por erro, e senha/segredo nunca entram em values de erro', async () => {
    const estado = await criarConta(inicial, formulario({ slug: 'a' }))
    expect(estado.ok).toBe(false)
    expect(JSON.stringify(estado)).not.toMatch(/afk_/)
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
    expect(await prisma.apiKey.count()).toBe(0)
  })

  test('erro de outra etapa (cor, termo, regra, módulos) é recusado ANTES de criar a conta, no campo certo', async () => {
    const casos: Array<[Record<string, string>, string]> = [
      [{ primary: 'vermelho' }, 'primary'],
      [{ club: '' }, 'club'],
      [{ slotStepMin: '7' }, 'slotStepMin'],
      [{ loyalty: '__ausente__', store: '__ausente__', vouchers: 'on' }, 'vouchers'],
      [{ ownerEmail: 'sem-arroba' }, 'ownerEmail'],
      [{ keyName: '' }, 'keyName'],
    ]
    for (const [extra, campo] of casos) {
      const estado = await criarConta(inicial, formulario(extra))
      expect(estado.ok, campo).toBe(false)
      expect(Object.keys(estado.fields), campo).toContain(campo)
    }
    expect(await prisma.business.count()).toBe(0)
  })

  test('sem chave de app marcada, não cria chave e não há segredo', async () => {
    const estado = await criarConta(inicial, formulario({ createKey: '__ausente__' }))
    expect(estado.ok).toBe(true)
    expect(estado.values.result?.secret).toBeUndefined()
    expect(await prisma.apiKey.count()).toBe(0)
  })

  test('falha ao criar a chave depois da conta: redireciona para a página da conta com o aviso do que faltou, sem segredo', async () => {
    chaves.falhar = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const destino = await redirecionamento(criarConta(inicial, formulario()))
    const conta = await prisma.business.findUniqueOrThrow({ where: { slug: 'pata-viva' } })
    expect(destino).toBe(`/contas/${conta.id}?faltou=chave`)
    expect(destino).not.toContain('hunter2')
    expect(await prisma.apiKey.count()).toBe(0)
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

  test('com logo no formulário, grava a imagem na marca; o arquivo não volta no estado', async () => {
    const png = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#2f6b4f' } }).png().toBuffer()
    const fd = formulario()
    fd.set('logo', new File([new Uint8Array(png)], 'logo.png', { type: 'image/png' }))
    const estado = await criarConta(inicial, fd)
    expect(estado.ok).toBe(true)
    expect(estado.values.logo).toBeUndefined()
    const marca = await prisma.businessBranding.findFirstOrThrow({ include: { logo: true } })
    expect(marca.logo).not.toBeNull()
  })

  test('logo que não é imagem: a conta fica criada, o secret aparece e o aviso diz que faltou a logo', async () => {
    const fd = formulario()
    fd.set('logo', new File(['isto não é uma imagem'], 'logo.png', { type: 'image/png' }))
    const estado = await criarConta(inicial, fd)
    expect(estado.ok).toBe(true)
    expect(estado.values.result?.pendencias).toEqual(['A logo'])
    expect(estado.values.result?.secret).toMatch(/^afk_a_/)
  })

  test('sem sessão de admin não cria nada', async () => {
    guards.requirePlatformAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarConta(inicial, formulario())).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.business.count()).toBe(0)
    expect(await prisma.user.count()).toBe(0)
  })
})
