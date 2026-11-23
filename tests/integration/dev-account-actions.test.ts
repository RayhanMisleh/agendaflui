import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const disco = vi.hoisted(() => ({ storage: null as import('@/server/storage/storage').Storage | null }))
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco.storage ?? real.getStorage() }
})
const canal = vi.hoisted(() => ({ falha: false }))
vi.mock('@/server/notifications/channels', async (original) => {
  const real = await original<typeof import('@/server/notifications/channels')>()
  return {
    ...real,
    getEmailChannel: () => ({
      send: vi.fn(async () => {
        if (canal.falha) throw new Error('falha de envio simulada')
      }),
    }),
  }
})

import {
  alternarAcesso,
  arquivarConta,
  reenviarConvite,
  salvarAvisos,
  salvarDados,
  salvarMarca,
  salvarModulos,
  salvarRegras,
  salvarTermos,
  suspenderConta,
  convidarMembro,
  trocarPapel,
} from '@/app/dev/(app)/contas/[id]/actions'
import { updateNotificationSettings } from '@/server/domain/settings/notification-settings'
import { updateSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { updateTermsAsOwner } from '@/server/domain/settings/business-profile'
import type { FormState } from '@/app/_lib/form-state'

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
    const campos = { version: String(conta.version), name: 'Digitado A', slug: conta.slug, document: '', contactEmail: '', contactPhone: '' }
    const a = await salvarDados(conta.id, ini, form(campos))
    expect(a.ok).toBe(true)
    expect(a.values.version).toBe(String(conta.version + 1))
    // Segunda pessoa, ainda com a versão antiga.
    const b = await salvarDados(conta.id, ini, form({ ...campos, name: 'Digitado B', contactEmail: 'b@exemplo.test' }))
    expect(b.ok).toBe(false)
    expect(b.message).toBe(MSG_CONFLITO)
    expect(b.values.name).toBe('Digitado B')
    expect(b.values.contactEmail).toBe('b@exemplo.test')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).name).toBe('Digitado A')
  })

  test('erro de campo volta no campo, com o valor digitado', async () => {
    const conta = await makeBusiness()
    const e = await salvarDados(conta.id, ini, form({ version: String(conta.version), name: conta.name, slug: 'Slug Inválido!', document: '', contactEmail: '', contactPhone: '' }))
    expect(e.ok).toBe(false)
    expect(e.fields.slug).toBeTruthy()
    expect(e.values.slug).toBe('Slug Inválido!')
  })

  test('sem sessão de admin a ação não executa nada', async () => {
    const conta = await makeBusiness({ name: 'Intacta' })
    guards.requirePlatformAdmin.mockRejectedValue(new Error('sem sessão'))
    await expect(salvarDados(conta.id, ini, form({ version: String(conta.version), name: 'Invasor', slug: conta.slug }))).rejects.toThrow('sem sessão')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).name).toBe('Intacta')
  })
})

describe('situação da conta', () => {
  test('nome errado não suspende; nome certo suspende; arquivar também pede o nome', async () => {
    const conta = await makeBusiness({ name: 'Pata Viva' })
    const errada = await suspenderConta(conta.id, ini, form({ confirmName: 'pata viva' }))
    expect(errada.ok).toBe(false)
    expect(errada.fields.confirmName).toBeTruthy()
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('ACTIVE')
    const certa = await suspenderConta(conta.id, ini, form({ confirmName: 'Pata Viva' }))
    expect(certa.ok).toBe(true)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('SUSPENDED')
    const arq = await arquivarConta(conta.id, ini, form({ confirmName: 'x' }))
    expect(arq.ok).toBe(false)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('SUSPENDED')
  })
})

describe('marca', () => {
  test('salva a marca com a versão do servidor e devolve a versão nova; versão antiga é conflito com o digitado', async () => {
    const conta = await makeBusiness()
    const marca = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })
    const campos = { version: String(marca.version), displayName: 'Nova Marca', primary: '#2f6b4f', accent: '#E8833A', material: 'LINEN' }
    const ok = await salvarMarca(conta.id, ini, form(campos))
    expect(ok.ok).toBe(true)
    expect(Number(ok.values.version)).toBe(marca.version + 1)
    const gravada = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })
    expect(gravada).toMatchObject({ displayName: 'Nova Marca', primaryColor: '#2F6B4F', coverMaterial: 'LINEN' })
    const velha = await salvarMarca(conta.id, ini, form({ ...campos, displayName: 'Outra' }))
    expect(velha.ok).toBe(false)
    expect(velha.message).toBe(MSG_CONFLITO)
    expect(velha.values.displayName).toBe('Outra')
  })
})

describe('versão das configurações nas gravações do painel dev', () => {
  const termos = { professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores', pointsSingular: 'Patinha', pointsPlural: 'Patinhas', club: 'Clube' }
  const regras = { slotStepMin: '15', minLeadMin: '60', maxAdvanceDays: '30', customerChangeWindowMin: '120', bufferMin: '0' }
  const versao = async (businessId: string) => (await prisma.businessSettings.findUniqueOrThrow({ where: { businessId } })).version

  test('termos: o dono muda um termo; o admin, com a versão antiga, recebe conflito e o termo do dono continua', async () => {
    const conta = await makeBusiness()
    const dono = await makeCtx(conta)
    const lida = await versao(conta.id)
    await updateTermsAsOwner(dono, lida, { ...termos, club: 'VIP' })
    const r = await salvarTermos(conta.id, ini, form({ ...termos, professionalSingular: 'Groomer', version: String(lida) }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(MSG_CONFLITO)
    expect(r.values.professionalSingular).toBe('Groomer')
    expect(await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ termClub: 'VIP', termProfessionalSingular: expect.not.stringMatching(/^Groomer$/) })
    const ok = await salvarTermos(conta.id, ini, form({ ...termos, club: 'VIP', professionalSingular: 'Groomer', version: String(lida + 1) }))
    expect(ok.ok).toBe(true)
    expect(ok.values.version).toBe(String(lida + 2))
  })

  test('regras: o dono muda o intervalo; o admin com a versão antiga recebe conflito e o intervalo do dono continua', async () => {
    const conta = await makeBusiness()
    const dono = await makeCtx(conta)
    const lida = await versao(conta.id)
    await updateSchedulingRules(dono, { bufferMin: 20 }, lida)
    const r = await salvarRegras(conta.id, ini, form({ ...regras, minLeadMin: '90', version: String(lida) }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(MSG_CONFLITO)
    expect(await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ bufferMin: 20, minLeadMin: 60 })
    const ok = await salvarRegras(conta.id, ini, form({ ...regras, bufferMin: '20', minLeadMin: '90', version: String(lida + 1) }))
    expect(ok.ok).toBe(true)
    expect(ok.values.version).toBe(String(lida + 2))
  })

  test('avisos: o dono muda um canal; o admin com a versão antiga recebe conflito e o canal do dono continua', async () => {
    const conta = await makeBusiness()
    const dono = await makeCtx(conta)
    const lida = await versao(conta.id)
    await updateNotificationSettings(dono, { APPOINTMENT_CONFIRMED: { push: false } }, lida)
    const r = await salvarAvisos(conta.id, ini, form({ APPOINTMENT_CONFIRMED__push: 'on', version: String(lida) }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(MSG_CONFLITO)
    const n = (await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).notifications as Record<string, { email: boolean; push: boolean }>
    expect(n.APPOINTMENT_CONFIRMED?.push).toBe(false)
    expect(n.APPOINTMENT_CANCELED?.email).toBe(true)
    const ok = await salvarAvisos(conta.id, ini, form({ APPOINTMENT_CONFIRMED__email: 'on', version: String(lida + 1) }))
    expect(ok.ok).toBe(true)
    expect(ok.values.version).toBe(String(lida + 2))
  })
})

describe('termos, módulos, regras e avisos', () => {
  test('termos gravam e termo vazio erra no campo', async () => {
    const conta = await makeBusiness()
    const base = { professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores', pointsSingular: 'Patinha', pointsPlural: 'Patinhas', club: 'Clube Pata' }
    const v1 = String((await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).version)
    expect((await salvarTermos(conta.id, ini, form({ ...base, version: v1 }))).ok).toBe(true)
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).termClub).toBe('Clube Pata')
    const vazioClube = await salvarTermos(conta.id, ini, form({ ...base, club: '', version: String(Number(v1) + 1) }))
    expect(vazioClube.ok).toBe(false)
    expect(vazioClube.fields.club).toBeTruthy()
  })

  test('salvar módulos grava os que estão marcados e desliga os outros', async () => {
    const conta = await makeBusiness()
    const ok = await salvarModulos(conta.id, ini, form({ store: 'on', loyalty: 'on' }))
    expect(ok.ok).toBe(true)
    expect(await prisma.businessModules.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ store: true, loyalty: true, banners: false })
  })

  test('regras gravam e o fuso da conta não muda; valor fora do limite erra no campo; campo em branco é recusado', async () => {
    const conta = await makeBusiness()
    const base = { slotStepMin: '30', minLeadMin: '90', maxAdvanceDays: '45', customerChangeWindowMin: '180', bufferMin: '10', autoConfirm: 'on' }
    const ok = await salvarRegras(conta.id, ini, form({ ...base, version: '1' }))
    expect(ok.ok).toBe(true)
    expect(ok.values.version).toBe('2')
    expect(await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: conta.id } })).toMatchObject({ slotStepMin: 30, bufferMin: 10, autoConfirm: true })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).timezone).toBe('America/Sao_Paulo')
    const alto = await salvarRegras(conta.id, ini, form({ ...base, maxAdvanceDays: '999', version: '2' }))
    expect(alto.ok).toBe(false)
    expect(alto.fields.maxAdvanceDays).toBeTruthy()
    const branco = await salvarRegras(conta.id, ini, form({ ...base, minLeadMin: '', version: '2' }))
    expect(branco.ok).toBe(false)
    expect(branco.fields.minLeadMin).toBeTruthy()
    // Um `timeZone` enviado à mão é ignorado: o fuso é fixo.
    await salvarRegras(conta.id, ini, form({ ...base, timeZone: 'Asia/Tokyo', version: '2' }))
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).timezone).toBe('America/Sao_Paulo')
  })

  test('avisos: caixa desmarcada desliga o canal daquele tipo', async () => {
    const conta = await makeBusiness()
    const r = await salvarAvisos(conta.id, ini, form({ version: '1', APPOINTMENT_CONFIRMED__email: 'on', APPOINTMENT_CANCELED__push: 'on' }))
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
    const r = await trocarPapel(conta.id, ini, form({ membershipId: dono.id, role: 'MANAGER' }))
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

    const outra = await trocarPapel(a.id, ini, form({ membershipId: deB.id, role: 'PROFESSIONAL' }))
    expect(outra.ok).toBe(false)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: deB.id } })).role).toBe('MANAGER')
    const outraAtivo = await alternarAcesso(a.id, ini, form({ membershipId: deB.id, active: 'false', confirmName: 'x' }))
    expect(outraAtivo.ok).toBe(false)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: deB.id } })).active).toBe(true)
    const outraConvite = await reenviarConvite(a.id, ini, form({ membershipId: deB.id }))
    expect(outraConvite.ok).toBe(false)

    expect((await trocarPapel(a.id, ini, form({ membershipId: gerente.id, role: 'PROFESSIONAL' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).role).toBe('PROFESSIONAL')

    const semNome = await alternarAcesso(a.id, ini, form({ membershipId: gerente.id, active: 'false', confirmName: 'errado' }))
    expect(semNome.ok).toBe(false)
    expect(semNome.fields.confirmName).toBeTruthy()
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(true)
    expect((await alternarAcesso(a.id, ini, form({ membershipId: gerente.id, active: 'false', confirmName: 'Gil Gerente' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(false)
    expect((await alternarAcesso(a.id, ini, form({ membershipId: gerente.id, active: 'true' }))).ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: gerente.id } })).active).toBe(true)
  })

  test('reenviar convite a quem já tem senha mostra a mensagem do domínio', async () => {
    const conta = await makeBusiness()
    const m = await makeMembership(conta.id, (await makeUser()).id, 'OWNER')
    const r = await reenviarConvite(conta.id, ini, form({ membershipId: m.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/já definiu a senha/)
    const pendente = await makeMembership(conta.id, (await makeUser({ password: null })).id, 'MANAGER')
    const enviado = await reenviarConvite(conta.id, ini, form({ membershipId: pendente.id }))
    expect(enviado).toMatchObject({ ok: true, message: 'Convite reenviado.' })
  })

  test('reenviar convite com o e-mail falhando diz "Convite não enviado", não "reenviado"', async () => {
    const conta = await makeBusiness()
    const pendente = await makeMembership(conta.id, (await makeUser({ password: null })).id, 'MANAGER')
    canal.falha = true
    try {
      const r = await reenviarConvite(conta.id, ini, form({ membershipId: pendente.id }))
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/^Convite não enviado/)
    } finally {
      canal.falha = false
    }
  })
})

describe('convidar membro novo', () => {
  test('cria o vínculo e o convite, devolve a mensagem e a pessoa aparece na equipe', async () => {
    const conta = await makeBusiness()
    const r = await convidarMembro(conta.id, ini, form({ name: 'Ana Gerente', email: 'ANA@exemplo.test', role: 'MANAGER' }))
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/^Convite enviado/)
    const m = await prisma.membership.findFirstOrThrow({ where: { businessId: conta.id }, include: { user: true } })
    expect([m.role, m.user.email]).toEqual(['MANAGER', 'ana@exemplo.test'])
    expect(m.inviteMailFailedAt).toBeNull()
  })

  test('com o e-mail falhando o cadastro fica e a tela diz "Convite não enviado", não "enviado"', async () => {
    const conta = await makeBusiness()
    canal.falha = true
    try {
      const r = await convidarMembro(conta.id, ini, form({ name: 'Ana Gerente', email: 'ana@exemplo.test', role: 'MANAGER' }))
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/^Convite não enviado/)
      expect(r.message).not.toMatch(/^Convite enviado/)
      // O cadastro existe (não dá para repetir o envio digitando de novo): o formulário limpa e o reenvio está na lista.
      expect(r.values).toMatchObject({ name: '', email: '' })
      const m = await prisma.membership.findFirstOrThrow({ where: { businessId: conta.id }, include: { user: true } })
      expect(m.user.email).toBe('ana@exemplo.test')
      expect(m.inviteMailFailedAt).not.toBeNull()
    } finally {
      canal.falha = false
    }
  })

  test('e-mail já vinculado à conta: erro do domínio no estado, com o que foi digitado', async () => {
    const conta = await makeBusiness()
    await convidarMembro(conta.id, ini, form({ name: 'Ana', email: 'ana@exemplo.test', role: 'MANAGER' }))
    const r = await convidarMembro(conta.id, ini, form({ name: 'Ana', email: 'ana@exemplo.test', role: 'PROFESSIONAL' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
    expect(r.values.email).toBe('ana@exemplo.test')
    expect(await prisma.membership.count({ where: { businessId: conta.id } })).toBe(1)
  })

  test('conta arquivada recusa com a mensagem do domínio; e-mail ou papel ruins erram no campo', async () => {
    const arquivada = await makeBusiness({ status: 'ARCHIVED' })
    const a = await convidarMembro(arquivada.id, ini, form({ name: 'Ana', email: 'ana@exemplo.test', role: 'MANAGER' }))
    expect(a.ok).toBe(false)
    expect(a.message).toMatch(/arquivada/i)
    const conta = await makeBusiness()
    const b = await convidarMembro(conta.id, ini, form({ name: 'Ana', email: 'sem-arroba', role: 'MANAGER' }))
    expect(b.ok).toBe(false)
    expect(b.fields.email).toBeTruthy()
  })
})

describe('o id da conta vem do servidor, não do formulário', () => {
  test('campo businessId forjado no formulário é ignorado: vale a conta ligada na ação', async () => {
    const a = await makeBusiness({ name: 'Conta A' })
    const b = await makeBusiness({ name: 'Conta B' })
    const r = await suspenderConta(a.id, ini, form({ businessId: b.id, confirmName: 'Conta A' }))
    expect(r.ok).toBe(true)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('SUSPENDED')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVE')
    const errado = await suspenderConta(b.id, ini, form({ businessId: a.id, confirmName: 'Conta A' }))
    expect(errado.ok).toBe(false)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVE')
  })

  test('id ligado que não é UUID não grava nada e não vaza erro técnico', async () => {
    const r = await salvarTermos('nao-e-uuid', ini, form({ club: 'X' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  })
})
