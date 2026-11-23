import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { addTeamMember } from '@/server/domain/team/access'
import { getTeamSheet } from '@/server/domain/team/sheet'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeAppointment, makeBusiness, makeCtx, makeCustomer, makeMembership, makePlatformAdmin, makeProfessional, makeService, makeUser, memberOf } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})
const disco = vi.hoisted(() => ({ storage: null as import('@/server/storage/storage').Storage | null }))
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco.storage ?? real.getStorage() }
})

import {
  alternarAcesso,
  arquivarProfissional,
  bloquearHorario,
  convidarAcesso,
  cadastrarNaEquipe,
  mudarPapelAcesso,
  redefinirSenhaAcesso,
  reenviarConviteAcesso,
  removerBloqueio,
  salvarDadosProfissional,
  salvarExpediente,
  salvarServicosProfissional,
} from '@/app/painel/(app)/equipe/actions'
import { POST as enviarFoto } from '@/app/painel/(app)/equipe/[id]/foto/route'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const mail = fakeMail()
const AGORA = new Date('2026-11-17T12:00:00.000Z')

function form(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  return fd
}

let dir: string
beforeAll(async () => {
  const { createLocalDiskStorage } = await import('@/server/storage/local-disk')
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-equipe-'))
  disco.storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ timezone: 'America/Sao_Paulo' })).id
  dono = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
  guards.requireTenant.mockResolvedValue(dono)
  mail.install()
})
afterEach(() => {
  guards.requireTenant.mockReset()
  mail.uninstall()
})

/** Um profissional com ficha ligada a um acesso PROFESSIONAL; devolve o contexto dele. */
async function comoProfissional(nome: string) {
  const ctx = await ctxWithRole({ id: businessId }, 'PROFESSIONAL', { now: AGORA })
  const ficha = await makeProfessional(businessId, { name: nome, membershipId: memberOf(ctx).membershipId })
  return { ctx, ficha }
}

describe('ficha: quem abre o quê', () => {
  test('profissional abrindo a ficha de um colega recebe "sem permissão"', async () => {
    const eu = await comoProfissional('Ana')
    const colega = await makeProfessional(businessId, { name: 'Caio' })
    const e = await domainError(getTeamSheet(eu.ctx, colega.id))
    expect(e.code).toBe('forbidden')
  })

  test('na própria ficha o profissional vê expediente e bloqueios, sem serviços nem acesso', async () => {
    const eu = await comoProfissional('Ana')
    const sheet = await getTeamSheet(eu.ctx, eu.ficha.id)
    expect(sheet.own).toBe(true)
    expect(sheet.fullAccess).toBe(false)
    expect(sheet.access).toBeNull()
    expect(sheet.services).toEqual([])
    expect(Object.keys(sheet.week)).toHaveLength(7)
  })

  test('o dono vê tudo: serviços que a pessoa faz e o acesso ligado', async () => {
    const eu = await comoProfissional('Ana')
    const banho = await makeService(businessId, { name: 'Banho' })
    await makeService(businessId, { name: 'Tosa' })
    await prisma.professionalService.create({ data: { businessId, professionalId: eu.ficha.id, serviceId: banho.id } })
    const sheet = await getTeamSheet(dono, eu.ficha.id)
    expect(sheet.fullAccess).toBe(true)
    expect(sheet.services.map((s) => [s.name, s.does])).toEqual([['Banho', true], ['Tosa', false]])
    expect(sheet.access).toMatchObject({ role: 'PROFESSIONAL', professionalId: eu.ficha.id })
  })

  test('ficha de outra conta ou inexistente: não encontrada', async () => {
    const outra = await makeBusiness()
    const alheia = await makeProfessional(outra.id, { name: 'Alheia' })
    expect((await domainError(getTeamSheet(dono, alheia.id))).code).toBe('not_found')
  })
})

describe('dados e comissão', () => {
  test('gerente altera a comissão e grava (12,5% = 1250)', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio', commissionBps: 3000 })
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    const r = await salvarDadosProfissional(ini, form({ id: p.id, name: 'Caio', bio: '', commission: '12,5', active: 'on' }))
    expect(r.ok).toBe(true)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })).commissionBps).toBe(1250)
  })

  test('profissional não altera a comissão, nem a própria', async () => {
    const eu = await comoProfissional('Ana')
    guards.requireTenant.mockResolvedValue(eu.ctx)
    const r = await salvarDadosProfissional(ini, form({ id: eu.ficha.id, name: 'Ana', bio: '', commission: '90', active: 'on' }))
    expect(r.message).toBe(NEGADO)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: eu.ficha.id } })).commissionBps).toBe(0)
  })

  test('comissão que não é porcentagem volta como erro no campo', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    for (const ruim of ['abc', '101', '-1', '']) {
      const r = await salvarDadosProfissional(ini, form({ id: p.id, name: 'Caio', commission: ruim, active: 'on' }))
      expect(r.ok, ruim).toBe(false)
      expect(Object.keys(r.fields), ruim).toEqual(['commission'])
    }
  })

  test('cadastrarNaEquipe grava ficha, acesso e convite e vai para a ficha nova', async () => {
    const r = cadastrarNaEquipe(ini, form({ name: 'Duda', email: 'duda@exemplo.test', role: 'PROFESSIONAL' }))
    await expect(r).rejects.toThrow(/NEXT_REDIRECT \/equipe\//)
    const p = await prisma.professional.findFirstOrThrow({ where: { businessId } })
    expect(p.name).toBe('Duda')
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { id: p.membershipId ?? '' }, include: { user: true } })
    expect(vinculo.user.email).toBe('duda@exemplo.test')
    expect(mail.sent.filter((m) => m.to === 'duda@exemplo.test')).toHaveLength(1)
  })

  test('cadastrarNaEquipe redireciona para a ficha criada', async () => {
    const e = await cadastrarNaEquipe(ini, form({ name: 'Duda', email: 'duda@exemplo.test', role: 'PROFESSIONAL' })).then(() => null, (x: Error) => x)
    const p = await prisma.professional.findFirstOrThrow({ where: { businessId } })
    expect(e?.message).toBe(`NEXT_REDIRECT /equipe/${p.id}`)
  })

  test('cadastrarNaEquipe sem e-mail volta erro no campo email e não grava nada', async () => {
    const r = await cadastrarNaEquipe(ini, form({ name: 'Duda', email: '', role: 'PROFESSIONAL' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toContain('email')
    expect(r.values.name).toBe('Duda')
    expect(await prisma.professional.count({ where: { businessId } })).toBe(0)
  })

  test('cadastrarNaEquipe com e-mail de outra loja volta a frase no campo email', async () => {
    const outra = await makeBusiness()
    const alheio = await makeUser({ email: 'alheio@exemplo.test' })
    await makeMembership(outra.id, alheio.id, 'MANAGER')
    const r = await cadastrarNaEquipe(ini, form({ name: 'Alheio', email: 'alheio@exemplo.test', role: 'PROFESSIONAL' }))
    expect(r.ok).toBe(false)
    expect(r.fields.email).toMatch(/outra loja/)
    expect(await prisma.professional.count({ where: { businessId } })).toBe(0)
  })

  test('papel de dono não passa por cadastrarNaEquipe', async () => {
    const r = await cadastrarNaEquipe(ini, form({ name: 'Duda', email: 'duda@exemplo.test', role: 'OWNER' }))
    expect(r.ok).toBe(false)
    expect(await prisma.professional.count({ where: { businessId } })).toBe(0)
  })

  test('profissional não cadastra ninguém', async () => {
    const eu = await comoProfissional('Ana')
    guards.requireTenant.mockResolvedValue(eu.ctx)
    const r = await cadastrarNaEquipe(ini, form({ name: 'Duda', email: 'duda@exemplo.test', role: 'PROFESSIONAL' }))
    expect(r.message).toBe(NEGADO)
  })

  test('salva os serviços que a pessoa faz', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const a = await makeService(businessId, { name: 'A' })
    const b = await makeService(businessId, { name: 'B' })
    await salvarServicosProfissional(ini, form({ id: p.id, serviceIds: [a.id, b.id] }))
    await salvarServicosProfissional(ini, form({ id: p.id, serviceIds: [b.id] }))
    expect((await prisma.professionalService.findMany({ where: { professionalId: p.id } })).map((s) => s.serviceId)).toEqual([b.id])
    await salvarServicosProfissional(ini, form({ id: p.id }))
    expect(await prisma.professionalService.count({ where: { professionalId: p.id } })).toBe(0)
  })
})

describe('expediente', () => {
  test('o profissional altera o próprio expediente', async () => {
    const eu = await comoProfissional('Ana')
    guards.requireTenant.mockResolvedValue(eu.ctx)
    const r = await salvarExpediente(ini, form({ id: eu.ficha.id, 'MONDAY.0.start': '09:00', 'MONDAY.0.end': '12:00', 'MONDAY.1.start': '13:30', 'MONDAY.1.end': '18:00' }))
    expect(r.ok).toBe(true)
    const linhas = await prisma.workingHours.findMany({ where: { professionalId: eu.ficha.id }, orderBy: { startMin: 'asc' } })
    expect(linhas.map((l) => [l.weekday, l.startMin, l.endMin])).toEqual([['MONDAY', 540, 720], ['MONDAY', 810, 1080]])
  })

  test('o profissional não altera o expediente do colega', async () => {
    const eu = await comoProfissional('Ana')
    const colega = await makeProfessional(businessId, { name: 'Caio' })
    guards.requireTenant.mockResolvedValue(eu.ctx)
    const r = await salvarExpediente(ini, form({ id: colega.id, 'MONDAY.0.start': '09:00', 'MONDAY.0.end': '12:00' }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('permissão')
    expect(await prisma.workingHours.count({ where: { professionalId: colega.id } })).toBe(0)
  })

  test('faixa invertida volta o erro na faixa certa (MONDAY.0.end) e não grava nada', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await salvarExpediente(ini, form({ id: p.id, 'TUESDAY.0.start': '09:00', 'TUESDAY.0.end': '12:00', 'MONDAY.0.start': '12:00', 'MONDAY.0.end': '09:00' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['MONDAY.0.end'])
    expect(r.values['MONDAY.0.start']).toBe('12:00')
    expect(await prisma.workingHours.count({ where: { professionalId: p.id } })).toBe(0)
  })

  test('hora que não é HH:mm e faixas sobrepostas voltam no campo', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r1 = await salvarExpediente(ini, form({ id: p.id, 'MONDAY.0.start': '9h', 'MONDAY.0.end': '12:00' }))
    expect(Object.keys(r1.fields)).toEqual(['MONDAY.0.start'])
    const r2 = await salvarExpediente(ini, form({ id: p.id, 'MONDAY.0.start': '09:00', 'MONDAY.0.end': '12:00', 'MONDAY.1.start': '11:00', 'MONDAY.1.end': '13:00' }))
    expect(r2.ok).toBe(false)
    expect(Object.keys(r2.fields)).toEqual(['MONDAY'])
  })

  test('um dia sem faixas fecha o dia (apaga o que havia)', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    await prisma.workingHours.create({ data: { businessId, professionalId: p.id, weekday: 'FRIDAY', startMin: 540, endMin: 1080 } })
    expect((await salvarExpediente(ini, form({ id: p.id, 'MONDAY.0.start': '09:00', 'MONDAY.0.end': '12:00' }))).ok).toBe(true)
    expect(await prisma.workingHours.count({ where: { professionalId: p.id, weekday: 'FRIDAY' } })).toBe(0)
  })
})

describe('bloqueios', () => {
  async function doisAgendamentos() {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const servico = await makeService(businessId, { name: 'Banho', durationMin: 30 })
    const cliente = await makeCustomer(businessId, { name: 'Marina' })
    // 10:00 e 11:00 em São Paulo (UTC-3), em 1/12/2026.
    for (const hora of [13, 14]) {
      await makeAppointment(businessId, { customerId: cliente.id, professionalId: p.id, serviceId: servico.id, startsAt: new Date(Date.UTC(2026, 11, 1, hora, 0)) })
    }
    return p
  }
  const bloqueio = (id: string, extra: Record<string, string> = {}) =>
    form({ id, startDate: '2026-12-01', startTime: '09:00', endDate: '2026-12-01', endTime: '12:00', reason: 'Consulta', ...extra })

  test('atingindo 2 agendamentos, a primeira chamada só avisa a contagem e não grava', async () => {
    const p = await doisAgendamentos()
    const r = await bloquearHorario(ini, bloqueio(p.id))
    expect(r.ok).toBe(false)
    expect(r.values.affected).toBe('2')
    expect(r.values.confirm).toBeTruthy()
    expect(r.message).toContain('2 agendamentos')
    expect(await prisma.timeBlock.count({ where: { professionalId: p.id } })).toBe(0)
  })

  test('confirmado, grava no horário local da conta', async () => {
    const p = await doisAgendamentos()
    const aviso = await bloquearHorario(ini, bloqueio(p.id))
    const r = await bloquearHorario(ini, bloqueio(p.id, { confirm: aviso.values.confirm ?? '' }))
    expect(r.ok).toBe(true)
    const b = await prisma.timeBlock.findFirstOrThrow({ where: { professionalId: p.id } })
    expect(b.startsAt.toISOString()).toBe('2026-12-01T12:00:00.000Z')
    expect(b.endsAt.toISOString()).toBe('2026-12-01T15:00:00.000Z')
    expect(b.reason).toBe('Consulta')
  })

  test('mudar o intervalo depois do aviso invalida a confirmação: avisa de novo e não grava', async () => {
    const p = await doisAgendamentos()
    const aviso = await bloquearHorario(ini, bloqueio(p.id))
    const r = await bloquearHorario(ini, bloqueio(p.id, { endTime: '15:00', confirm: aviso.values.confirm ?? '' }))
    expect(r.ok).toBe(false)
    expect(r.values.affected).toBe('2')
    expect(await prisma.timeBlock.count({ where: { professionalId: p.id } })).toBe(0)
    expect((await bloquearHorario(ini, bloqueio(p.id, { confirm: '1' }))).ok).toBe(false)
  })

  test('sem agendamentos no intervalo, grava direto', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await bloquearHorario(ini, bloqueio(p.id))
    expect(r.ok).toBe(true)
    expect(await prisma.timeBlock.count({ where: { professionalId: p.id } })).toBe(1)
  })

  test('fim antes do início volta no campo do fim; data inválida no campo da data', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await bloquearHorario(ini, bloqueio(p.id, { endTime: '08:00' }))
    expect(r.ok).toBe(false)
    expect(r.fields.endTime).toBeTruthy()
    const r2 = await bloquearHorario(ini, bloqueio(p.id, { startDate: '' }))
    expect(r2.fields.startDate).toBeTruthy()
    expect(await prisma.timeBlock.count({ where: { professionalId: p.id } })).toBe(0)
  })

  test('o profissional bloqueia a própria agenda, não a do colega; e remove o próprio bloqueio', async () => {
    const eu = await comoProfissional('Ana')
    const colega = await makeProfessional(businessId, { name: 'Caio' })
    guards.requireTenant.mockResolvedValue(eu.ctx)
    expect((await bloquearHorario(ini, bloqueio(eu.ficha.id))).ok).toBe(true)
    expect((await bloquearHorario(ini, bloqueio(colega.id))).ok).toBe(false)
    const b = await prisma.timeBlock.findFirstOrThrow({ where: { professionalId: eu.ficha.id } })
    expect((await removerBloqueio(ini, form({ id: b.id }))).ok).toBe(true)
    expect(await prisma.timeBlock.count()).toBe(0)
  })
})

describe('removerBloqueio: recusas', () => {
  const novoBloqueio = (professionalId: string, empresa = businessId) =>
    prisma.timeBlock.create({
      data: {
        businessId: empresa,
        professionalId,
        startsAt: new Date('2026-11-20T12:00:00Z'),
        endsAt: new Date('2026-11-20T14:00:00Z'),
        createdByType: 'SYSTEM',
      },
    })

  test('o profissional não remove o bloqueio de um colega', async () => {
    const eu = await comoProfissional('Ana')
    const colega = await makeProfessional(businessId, { name: 'Caio' })
    const b = await novoBloqueio(colega.id)
    guards.requireTenant.mockResolvedValue(eu.ctx)
    const r = await removerBloqueio(ini, form({ id: b.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Você não tem permissão para alterar a agenda deste profissional')
    expect(await prisma.timeBlock.count({ where: { id: b.id } })).toBe(1)
  })

  test('id de outra conta, inexistente ou malformado: não encontrado, e o bloqueio alheio fica', async () => {
    const outra = await makeBusiness()
    const alheia = await makeProfessional(outra.id, { name: 'Alheia' })
    const b = await novoBloqueio(alheia.id, outra.id)
    for (const id of [b.id, '11111111-1111-4111-8111-111111111111', 'x']) {
      const r = await removerBloqueio(ini, form({ id }))
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/não encontrad/i)
    }
    expect(await prisma.timeBlock.count({ where: { id: b.id } })).toBe(1)
  })

  test('o suporte (entrando como) tem os poderes do dono e remove o bloqueio', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const b = await novoBloqueio(p.id)
    const admin = await makePlatformAdmin()
    guards.requireTenant.mockResolvedValue(
      await makeCtx({ id: businessId }, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name }, now: AGORA }),
    )
    expect((await removerBloqueio(ini, form({ id: b.id }))).ok).toBe(true)
    expect(await prisma.timeBlock.count({ where: { id: b.id } })).toBe(0)
  })
})

describe('acessos', () => {
  test('convidar o acesso para a ficha cria o vínculo ligado e manda o convite', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await convidarAcesso(ini, form({ id: p.id, name: 'Caio Souza', email: 'caio@exemplo.com', role: 'PROFESSIONAL' }))
    expect(r.ok).toBe(true)
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })
    expect(ficha.membershipId).not.toBeNull()
    const vinculo = await prisma.membership.findUniqueOrThrow({ where: { id: ficha.membershipId ?? '' }, include: { user: true } })
    expect(vinculo).toMatchObject({ role: 'PROFESSIONAL', active: true, businessId })
    expect(vinculo.user.email).toBe('caio@exemplo.com')
    expect(mail.sent.filter((m) => m.to === 'caio@exemplo.com')).toHaveLength(1)
  })

  test('convidar o acesso com o e-mail falhando diz "Convite não enviado" e o cadastro fica', async () => {
    const p = await makeProfessional(businessId, { name: 'Dani' })
    mail.failing = true
    const r = await convidarAcesso(ini, form({ id: p.id, name: 'Dani Souza', email: 'dani@exemplo.com', role: 'PROFESSIONAL' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/^Convite não enviado/)
    expect(r.message).not.toMatch(/Convite enviado/)
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })
    const vinculo = await prisma.membership.findUniqueOrThrow({ where: { id: ficha.membershipId ?? '' } })
    expect(vinculo.inviteMailFailedAt).not.toBeNull()
  })

  test('reenviar convite: com o e-mail saindo confirma; falhando diz "Convite não enviado" e o cadastro fica', async () => {
    const m = await addTeamMember(dono, { name: 'Eva Dias', email: 'eva@exemplo.test', role: 'PROFESSIONAL' })
    const ok = await reenviarConviteAcesso(ini, form({ membershipId: m.membershipId }))
    expect(ok).toMatchObject({ ok: true, message: 'Convite reenviado.' })
    mail.failing = true
    const falha = await reenviarConviteAcesso(ini, form({ membershipId: m.membershipId }))
    expect(falha.ok).toBe(false)
    expect(falha.message).toMatch(/^Convite não enviado/)
    expect(falha.message).not.toMatch(/reenviado/)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).inviteMailFailedAt).not.toBeNull()
  })

  test('gerente não convida dono; profissional não convida ninguém', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    const r = await convidarAcesso(ini, form({ id: p.id, name: 'Chefe', email: 'chefe@exemplo.com', role: 'OWNER' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
    expect(r.message).not.toBe(NEGADO)
    expect(await prisma.membership.count({ where: { businessId, role: 'OWNER' } })).toBe(1)
    guards.requireTenant.mockResolvedValue((await comoProfissional('Ana')).ctx)
    expect((await convidarAcesso(ini, form({ id: p.id, name: 'X', email: 'x@exemplo.com', role: 'PROFESSIONAL' }))).message).toBe(NEGADO)
  })

  test('desativar o acesso pelo dono derruba a sessão da pessoa', async () => {
    const eu = await comoProfissional('Ana')
    const m = memberOf(eu.ctx)
    const sessao = await prisma.session.create({ data: { userId: m.userId, activeBusinessId: businessId, tokenHash: hashToken('t'), expiresAt: addMinutes(AGORA, 600) } })
    const r = await alternarAcesso(ini, form({ membershipId: m.membershipId, active: '0' }))
    expect(r.ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).active).toBe(false)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
  })

  test('muda o papel do acesso', async () => {
    const eu = await comoProfissional('Ana')
    const r = await mudarPapelAcesso(ini, form({ membershipId: memberOf(eu.ctx).membershipId, role: 'MANAGER' }))
    expect(r.ok).toBe(true)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(eu.ctx).membershipId } })).role).toBe('MANAGER')
  })

  test('redefinição de senha da equipe sai pelo dono e é recusada ao suporte', async () => {
    const eu = await comoProfissional('Ana')
    const alvo = memberOf(eu.ctx).membershipId
    const user = await prisma.user.findUniqueOrThrow({ where: { id: memberOf(eu.ctx).userId } })
    expect((await redefinirSenhaAcesso(ini, form({ membershipId: alvo }))).ok).toBe(true)
    expect(mail.sent.filter((m) => m.to === user.email)).toHaveLength(1)
    const admin = await prisma.platformAdmin.create({ data: { name: 'Adm', email: 'adm@exemplo.test', passwordHash: 'x' } })
    guards.requireTenant.mockResolvedValue(await makeCtx({ id: businessId }, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } }))
    const r = await redefinirSenhaAcesso(ini, form({ membershipId: alvo }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('suporte')
  })

  test('acesso de outra conta não é encontrado', async () => {
    const outra = await makeBusiness()
    const user = await makeUser()
    const alheio = await makeMembership(outra.id, user.id, 'PROFESSIONAL')
    const r = await alternarAcesso(ini, form({ membershipId: alheio.id, active: '0' }))
    expect(r.ok).toBe(false)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: alheio.id } })).active).toBe(true)
  })
})

describe('remover profissional', () => {
  test('arquiva a ficha e desativa o acesso ligado', async () => {
    const eu = await comoProfissional('Ana')
    const m = memberOf(eu.ctx)
    const r = await arquivarProfissional(ini, form({ id: eu.ficha.id }))
    expect(r.ok).toBe(true)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: eu.ficha.id } })).archivedAt).not.toBeNull()
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.membershipId } })).active).toBe(false)
  })

  test('com agendamentos futuros recusa e não mexe no acesso', async () => {
    const eu = await comoProfissional('Ana')
    const servico = await makeService(businessId)
    const cliente = await makeCustomer(businessId)
    await makeAppointment(businessId, { customerId: cliente.id, professionalId: eu.ficha.id, serviceId: servico.id, startsAt: addMinutes(AGORA, 600) })
    const r = await arquivarProfissional(ini, form({ id: eu.ficha.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('agendamento')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(eu.ctx).membershipId } })).active).toBe(true)
  })

  test('profissional não remove ninguém', async () => {
    const eu = await comoProfissional('Ana')
    guards.requireTenant.mockResolvedValue(eu.ctx)
    expect((await arquivarProfissional(ini, form({ id: eu.ficha.id }))).message).toBe(NEGADO)
  })
})

describe('rota da foto', () => {
  const OK = { host: 'painel.localhost:3000', origin: 'http://painel.localhost:3000' }
  const png = async () => new File([new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0e4f5c' } }).png().toBuffer())], 'foto.png', { type: 'image/png' })
  function pedido(id: string, campos: Record<string, string | File>, headers: Record<string, string> = OK) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    return [new Request(`http://painel.localhost:3000/equipe/${id}/foto`, { method: 'POST', headers, body: fd }), { params: Promise.resolve({ id }) }] as const
  }

  test('envia a foto, volta à ficha e liga o arquivo ao profissional', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await enviarFoto(...pedido(p.id, { file: await png() }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/equipe/${p.id}?foto=ok`)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })).avatarUploadId).not.toBeNull()
  })

  test('o profissional envia a própria foto, mas não a do colega', async () => {
    const eu = await comoProfissional('Ana')
    const colega = await makeProfessional(businessId, { name: 'Caio' })
    guards.requireTenant.mockResolvedValue(eu.ctx)
    expect((await enviarFoto(...pedido(eu.ficha.id, { file: await png() }))).headers.get('location')).toBe(`/equipe/${eu.ficha.id}?foto=ok`)
    const r = await enviarFoto(...pedido(colega.id, { file: await png() }))
    expect(r.headers.get('location')).toBe(`/equipe/${colega.id}?foto=refused`)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: colega.id } })).avatarUploadId).toBeNull()
  })

  test('remove a foto com intent=remove', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    await enviarFoto(...pedido(p.id, { file: await png() }))
    const r = await enviarFoto(...pedido(p.id, { intent: 'remove' }))
    expect(r.headers.get('location')).toBe(`/equipe/${p.id}?foto=ok`)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: p.id } })).avatarUploadId).toBeNull()
  })

  test('sem sessão: recusada antes de tocar o arquivo', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    guards.requireTenant.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(enviarFoto(...pedido(p.id, { file: await png() }))).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.upload.count()).toBe(0)
  })

  test('origem de outro site, ou sem origem: 403 e nada é gravado', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const outras: Record<string, string>[] = [{ host: 'painel.localhost:3000', origin: 'http://evil.example' }, { host: 'painel.localhost:3000' }]
    for (const headers of outras) {
      const r = await enviarFoto(...pedido(p.id, { file: await png() }, headers))
      expect(r.status).toBe(403)
    }
    expect(await prisma.upload.count()).toBe(0)
  })

  test('arquivo que não é imagem volta com o código do motivo', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    const r = await enviarFoto(...pedido(p.id, { file: new File(['oi'], 'x.txt', { type: 'text/plain' }) }))
    expect(r.headers.get('location')).toBe(`/equipe/${p.id}?foto=not_an_image`)
  })

  test('sem arquivo e arquivo grande demais', async () => {
    const p = await makeProfessional(businessId, { name: 'Caio' })
    expect((await enviarFoto(...pedido(p.id, {}))).headers.get('location')).toBe(`/equipe/${p.id}?foto=no_file`)
    const grande = new File([new Uint8Array(8 * 1024 * 1024 + 10)], 'g.png', { type: 'image/png' })
    expect((await enviarFoto(...pedido(p.id, { file: grande }))).headers.get('location')).toBe(`/equipe/${p.id}?foto=too_large`)
  })

  test('a rota só aceita POST', async () => {
    const rota = await import('@/app/painel/(app)/equipe/[id]/foto/route')
    expect(Object.keys(rota)).toEqual(['POST'])
  })
})
