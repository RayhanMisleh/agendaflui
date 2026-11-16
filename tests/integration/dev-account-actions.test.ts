import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const disco = vi.hoisted(() => ({ storage: null as import('@/server/storage/storage').Storage | null }))
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco.storage ?? real.getStorage() }
})
vi.mock('@/server/notifications/channels', async (original) => {
  const real = await original<typeof import('@/server/notifications/channels')>()
  return { ...real, getEmailChannel: () => ({ send: vi.fn(async () => undefined) }) }
})

import {
  alternarAcesso,
  arquivarConta,
  criarChave,
  editarOrigens,
  reenviarConvite,
  revogarChave,
  salvarAvisos,
  salvarDados,
  salvarMarca,
  salvarModulos,
  salvarRegras,
  salvarTermos,
  suspenderConta,
  trocarImagem,
  trocarPapel,
} from '@/app/dev/(app)/contas/[id]/actions'
import { listApiKeys } from '@/server/domain/platform/api-keys'
import type { FormState } from '@/app/dev/(app)/_lib/form-state'

const vazio: FormState<Record<string, never>> = { ok: false, message: null, fields: {}, values: {} }
// As ações aceitam qualquer estado anterior; o teste só precisa de um estado inicial.
const ini = vazio as never

function form(campos: Record<string, string | File>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let dir: string
let adminAtual: { adminId: string; name: string }
beforeAll(async () => {
  const { createLocalDiskStorage } = await import('@/server/storage/local-disk')
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-conta-'))
  disco.storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  adminAtual = { adminId: admin.id, name: admin.name }
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', ...adminAtual })
})
afterEach(() => {
  guards.requirePlatformAdmin.mockReset()
})

const MSG_CONFLITO = 'Outra pessoa alterou esta conta. Recarregue para ver a versão atual.'

describe('dados da conta', () => {
  test('versão antiga devolve o conflito e mantém o que foi digitado, sem gravar', async () => {
    const conta = await makeBusiness({ name: 'Original' })
    const campos = { businessId: conta.id, version: String(conta.version), name: 'Digitado A', slug: conta.slug, legalName: '', document: '', contactEmail: '', contactPhone: '', internalNotes: '' }
    const a = await salvarDados(ini, form(campos))
    expect(a.ok).toBe(true)
    expect(a.values.version).toBe(String(conta.version + 1))
    // Segunda pessoa, ainda com a versão antiga.
    const b = await salvarDados(ini, form({ ...campos, name: 'Digitado B', internalNotes: 'nota minha' }))
    expect(b.ok).toBe(false)
    expect(b.message).toBe(MSG_CONFLITO)
    expect(b.values.name).toBe('Digitado B')
    expect(b.values.internalNotes).toBe('nota minha')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).name).toBe('Digitado A')
  })

  test('erro de campo volta no campo, com o valor digitado', async () => {
    const conta = await makeBusiness()
    const e = await salvarDados(ini, form({ businessId: conta.id, version: String(conta.version), name: conta.name, slug: 'Slug Inválido!', legalName: '', document: '', contactEmail: '', contactPhone: '', internalNotes: '' }))
    expect(e.ok).toBe(false)
    expect(e.fields.slug).toBeTruthy()
    expect(e.values.slug).toBe('Slug Inválido!')
  })

  test('sem sessão de admin a ação não executa nada', async () => {
    const conta = await makeBusiness({ name: 'Intacta' })
    guards.requirePlatformAdmin.mockRejectedValue(new Error('sem sessão'))
    await expect(salvarDados(ini, form({ businessId: conta.id, version: String(conta.version), name: 'Invasor', slug: conta.slug }))).rejects.toThrow('sem sessão')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).name).toBe('Intacta')
  })
})

describe('situação da conta', () => {
  test('nome errado não suspende; nome certo suspende; arquivar também pede o nome', async () => {
    const conta = await makeBusiness({ name: 'Pata Viva' })
    const errada = await suspenderConta(ini, form({ businessId: conta.id, confirmName: 'pata viva' }))
    expect(errada.ok).toBe(false)
    expect(errada.fields.confirmName).toBeTruthy()
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('ACTIVE')
    const certa = await suspenderConta(ini, form({ businessId: conta.id, confirmName: 'Pata Viva' }))
    expect(certa.ok).toBe(true)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('SUSPENDED')
    const arq = await arquivarConta(ini, form({ businessId: conta.id, confirmName: 'x' }))
    expect(arq.ok).toBe(false)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('SUSPENDED')
  })
})

describe('marca', () => {
  test('salva a marca com a versão do servidor e devolve a versão nova; versão antiga é conflito com o digitado', async () => {
    const conta = await makeBusiness()
    const marca = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })
    const campos = { businessId: conta.id, version: String(marca.version), displayName: 'Nova Marca', primary: '#2f6b4f', accent: '#E8833A', material: 'LINEN', paper: 'CREAM', fontPair: 'FRIENDLY', loginMessage: 'Oi' }
    const ok = await salvarMarca(ini, form(campos))
    expect(ok.ok).toBe(true)
    expect(Number(ok.values.version)).toBe(marca.version + 1)
    const gravada = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })
    expect(gravada).toMatchObject({ displayName: 'Nova Marca', primaryColor: '#2F6B4F', coverMaterial: 'LINEN' })
    const velha = await salvarMarca(ini, form({ ...campos, displayName: 'Outra' }))
    expect(velha.ok).toBe(false)
    expect(velha.message).toBe(MSG_CONFLITO)
    expect(velha.values.displayName).toBe('Outra')
  })

  test('cada slot de imagem envia e remove; arquivo que não é imagem erra no slot; sem arquivo pede um', async () => {
    const conta = await makeBusiness()
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0e4f5c' } }).png().toBuffer()
    const enviar = await trocarImagem(ini, form({ businessId: conta.id, slot: 'logo', intent: 'send', file: new File([new Uint8Array(png)], 'logo.png', { type: 'image/png' }) }))
    expect(enviar.ok).toBe(true)
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })).logoUploadId).not.toBeNull()
    const ruim = await trocarImagem(ini, form({ businessId: conta.id, slot: 'favicon', intent: 'send', file: new File(['texto'], 'x.png', { type: 'image/png' }) }))
    expect(ruim.ok).toBe(false)
    expect(ruim.fields.favicon).toBeTruthy()
    const sem = await trocarImagem(ini, form({ businessId: conta.id, slot: 'symbol', intent: 'send' }))
    expect(sem.ok).toBe(false)
    expect(sem.fields.symbol).toBeTruthy()
    const remover = await trocarImagem(ini, form({ businessId: conta.id, slot: 'logo', intent: 'remove' }))
    expect(remover.ok).toBe(true)
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })).logoUploadId).toBeNull()
  })
})

describe('termos, módulos, regras e avisos', () => {
  test('termos gravam e termo vazio erra no campo', async () => {
    const conta = await makeBusiness()
    const base = { businessId: conta.id, professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores', pointsSingular: 'Patinha', pointsPlural: 'Patinhas', club: 'Clube Pata' }
    expect((await salvarTermos(ini, form(base))).ok).toBe(true)
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).termClub).toBe('Clube Pata')
    const vazioClube = await salvarTermos(ini, form({ ...base, club: '' }))
    expect(vazioClube.ok).toBe(false)
    expect(vazioClube.fields.club).toBeTruthy()
  })

  test('ligar vouchers sem loja devolve o erro no campo e não grava; com loja grava', async () => {
    const conta = await makeBusiness()
    const e = await salvarModulos(ini, form({ businessId: conta.id, vouchers: 'on' }))
    expect(e.ok).toBe(false)
    expect(e.fields.vouchers).toMatch(/Loja/)
    expect(await prisma.businessModules.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ vouchers: false, store: false })
    const ok = await salvarModulos(ini, form({ businessId: conta.id, vouchers: 'on', store: 'on', loyalty: 'on' }))
    expect(ok.ok).toBe(true)
    expect(await prisma.businessModules.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ vouchers: true, store: true, loyalty: true, banners: false })
  })

  test('regras e fuso gravam juntos; valor fora do limite erra no campo; campo em branco é recusado', async () => {
    const conta = await makeBusiness()
    const base = { businessId: conta.id, slotStepMin: '30', minLeadMin: '90', maxAdvanceDays: '45', customerChangeWindowMin: '180', bufferMin: '10', timeZone: 'America/Manaus', autoConfirm: 'on' }
    const ok = await salvarRegras(ini, form(base))
    expect(ok.ok).toBe(true)
    expect(await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ slotStepMin: 30, bufferMin: 10, autoConfirm: true })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).timezone).toBe('America/Manaus')
    const alto = await salvarRegras(ini, form({ ...base, maxAdvanceDays: '999' }))
    expect(alto.ok).toBe(false)
    expect(alto.fields.maxAdvanceDays).toBeTruthy()
    const branco = await salvarRegras(ini, form({ ...base, minLeadMin: '' }))
    expect(branco.ok).toBe(false)
    expect(branco.fields.minLeadMin).toBeTruthy()
    const fuso = await salvarRegras(ini, form({ ...base, timeZone: 'Marte/Olimpo' }))
    expect(fuso.fields.timeZone).toBeTruthy()
  })

  test('avisos: caixa desmarcada desliga o canal daquele tipo', async () => {
    const conta = await makeBusiness()
    const r = await salvarAvisos(ini, form({ businessId: conta.id, APPOINTMENT_CONFIRMED__email: 'on', APPOINTMENT_CANCELED__push: 'on' }))
    expect(r.ok).toBe(true)
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })
    const n = s.notifications as Record<string, { email: boolean; push: boolean }>
    expect(n.APPOINTMENT_CONFIRMED).toEqual({ email: true, push: false })
    expect(n.APPOINTMENT_CANCELED).toEqual({ email: false, push: true })
    expect(n.STAFF_NEW_APPOINTMENT).toEqual({ email: false, push: false })
  })
})

describe('equipe', () => {
  test('trocar o papel do último dono devolve a mensagem do domínio e nada muda', async () => {
    const conta = await makeBusiness()
    const dono = await makeMembership(conta.id, (await makeUser()).id, 'OWNER')
    const r = await trocarPapel(ini, form({ businessId: conta.id, membershipId: dono.id, role: 'MANAGER' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/nenhum dono ativo/)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: dono.id } })).role).toBe('OWNER')
  })

  test('troca de papel e desativar/reativar com o nome; vínculo de OUTRA conta não é tocado', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    await makeMembership(a.id, (await makeUser()).id, 'OWNER')
    const gerenteUser = await makeUser({ name: 'Gil Gerente' })
    const gerente = await makeMembership(a.id, gerenteUser.id, 'MANAGER')
    const deB = await makeMembership(b.id, (await makeUser()).id, 'MANAGER')

    const outra = await trocarPapel(ini, form({ businessId: a.id, membershipId: deB.id, role: 'PROFESSIONAL' }))
    expect(outra.ok).toBe(false)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: deB.id } })).role).toBe('MANAGER')
    const outraAtivo = await alternarAcesso(ini, form({ businessId: a.id, membershipId: deB.id, active: 'false', confirmName: 'x' }))
    expect(outraAtivo.ok).toBe(false)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: deB.id } })).active).toBe(true)
    const outraConvite = await reenviarConvite(ini, form({ businessId: a.id, membershipId: deB.id }))
    expect(outraConvite.ok).toBe(false)

    expect((await trocarPapel(ini, form({ businessId: a.id, membershipId: gerente.id, role: 'PROFESSIONAL' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).role).toBe('PROFESSIONAL')

    const semNome = await alternarAcesso(ini, form({ businessId: a.id, membershipId: gerente.id, active: 'false', confirmName: 'errado' }))
    expect(semNome.ok).toBe(false)
    expect(semNome.fields.confirmName).toBeTruthy()
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(true)
    expect((await alternarAcesso(ini, form({ businessId: a.id, membershipId: gerente.id, active: 'false', confirmName: 'Gil Gerente' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(false)
    expect((await alternarAcesso(ini, form({ businessId: a.id, membershipId: gerente.id, active: 'true' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(true)
  })

  test('reenviar convite a quem já tem senha mostra a mensagem do domínio', async () => {
    const conta = await makeBusiness()
    const m = await makeMembership(conta.id, (await makeUser()).id, 'OWNER')
    const r = await reenviarConvite(ini, form({ businessId: conta.id, membershipId: m.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/já definiu a senha/)
    const pendente = await makeMembership(conta.id, (await makeUser({ password: null })).id, 'MANAGER')
    expect((await reenviarConvite(ini, form({ businessId: conta.id, membershipId: pendente.id }))).ok).toBe(true)
  })
})

describe('chaves', () => {
  test('criar devolve o segredo uma vez; a listagem seguinte e o banco não o contêm', async () => {
    const conta = await makeBusiness()
    const r = await criarChave(ini, form({ businessId: conta.id, name: 'App Pata', origins: 'https://app.exemplo.com\nhttps://b.exemplo.com' }))
    expect(r.ok).toBe(true)
    const segredo = r.values.secret
    expect(segredo).toMatch(/^afk_a_/)
    const lista = await listApiKeys({ kind: 'platform_admin', ...adminAtual }, { businessId: conta.id })
    expect(lista).toHaveLength(1)
    expect(lista[0]?.allowedOrigins).toEqual(['https://app.exemplo.com', 'https://b.exemplo.com'])
    expect(JSON.stringify(lista)).not.toContain(segredo)
    const linha = await prisma.apiKey.findFirstOrThrow({ where: { businessId: conta.id } })
    expect(JSON.stringify(linha)).not.toContain(segredo)
    const auditoria = await prisma.auditLog.findMany({ where: { businessId: conta.id } })
    expect(JSON.stringify(auditoria)).not.toContain(segredo)
  })

  test('origem inválida erra no campo de origens e não cria a chave', async () => {
    const conta = await makeBusiness()
    const r = await criarChave(ini, form({ businessId: conta.id, name: 'App', origins: 'isto não é origem' }))
    expect(r.ok).toBe(false)
    expect(r.fields.origins).toBeTruthy()
    expect(r.values.origins).toBe('isto não é origem')
    expect(await prisma.apiKey.count({ where: { businessId: conta.id } })).toBe(0)
  })

  test('revogar pede o nome da chave; chave de OUTRA conta pelo formulário desta não é revogada', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const chaveA = (await criarChave(ini, form({ businessId: a.id, name: 'Chave A', origins: '' }))).ok
    expect(chaveA).toBe(true)
    await criarChave(ini, form({ businessId: b.id, name: 'Chave B', origins: '' }))
    const kA = await prisma.apiKey.findFirstOrThrow({ where: { businessId: a.id } })
    const kB = await prisma.apiKey.findFirstOrThrow({ where: { businessId: b.id } })

    const alheia = await revogarChave(ini, form({ businessId: a.id, keyId: kB.id, confirmName: 'Chave B' }))
    expect(alheia.ok).toBe(false)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: kB.id } })).revokedAt).toBeNull()
    const origensAlheias = await editarOrigens(ini, form({ businessId: a.id, keyId: kB.id, origins: 'https://x.exemplo.com' }))
    expect(origensAlheias.ok).toBe(false)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: kB.id } })).allowedOrigins).toEqual([])

    const semNome = await revogarChave(ini, form({ businessId: a.id, keyId: kA.id, confirmName: 'outra' }))
    expect(semNome.ok).toBe(false)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: kA.id } })).revokedAt).toBeNull()
    expect((await revogarChave(ini, form({ businessId: a.id, keyId: kA.id, confirmName: 'Chave A' }))).ok).toBe(true)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: kA.id } })).revokedAt).not.toBeNull()
  })

  test('editar origens da própria chave grava', async () => {
    const conta = await makeBusiness()
    await criarChave(ini, form({ businessId: conta.id, name: 'K', origins: '' }))
    const k = await prisma.apiKey.findFirstOrThrow({ where: { businessId: conta.id } })
    const r = await editarOrigens(ini, form({ businessId: conta.id, keyId: k.id, origins: 'https://novo.exemplo.com' }))
    expect(r.ok).toBe(true)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } })).allowedOrigins).toEqual(['https://novo.exemplo.com'])
  })
})
