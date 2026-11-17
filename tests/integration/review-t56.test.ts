import sharp from 'sharp'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { createService, updateService } from '@/server/domain/catalog/services'
import { listCustomers, anonymizeCustomer, archiveCustomer, isCustomerAnonymized } from '@/server/domain/customers/customers'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import { removeProfessional } from '@/server/domain/team/removal'
import { setProfessionalAvatar } from '@/server/domain/team/avatar'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeAppointment, makeBusiness, makeCtx, makeCustomer, makeMembership, makePlatformAdmin, makeProfessional, makeService, makeUser, memberOf } from '../setup/factories'

const AGORA = new Date('2026-11-17T12:00:00Z')
beforeEach(resetDb)

/** Profissional ligado ao acesso do ator dado. */
async function fichaDe(businessId: string, ctx: Awaited<ReturnType<typeof ctxWithRole>>, name = 'Ficha') {
  return makeProfessional(businessId, { name, membershipId: memberOf(ctx).membershipId })
}

describe('remover profissional é tudo ou nada', () => {
  test('o dono removendo a própria ficha é recusado e nada muda', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const ficha = await fichaDe(b.id, dono)
    await domainError(removeProfessional(dono, ficha.id))
    expect(await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).toMatchObject({ archivedAt: null, membershipId: memberOf(dono).membershipId })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(dono).membershipId } })).active).toBe(true)
  })

  test('o gerente removendo a ficha de um dono é recusado e nada muda', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER', { now: AGORA })
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const ficha = await fichaDe(b.id, dono)
    await domainError(removeProfessional(gerente, ficha.id))
    expect(await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).toMatchObject({ archivedAt: null, membershipId: memberOf(dono).membershipId })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(dono).membershipId } })).active).toBe(true)
  })

  test('o suporte removendo a ficha do último dono ativo é recusado e nada muda', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const ficha = await fichaDe(b.id, dono)
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name }, now: AGORA })
    const e = await domainError(removeProfessional(suporte, ficha.id))
    expect(e.message).toMatch(/nenhum dono ativo/)
    expect(await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).toMatchObject({ archivedAt: null, membershipId: memberOf(dono).membershipId })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(dono).membershipId } })).active).toBe(true)
  })

  test('com agendamento futuro recusa sem tocar no acesso', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER', { now: AGORA })
    const prof = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
    const ficha = await fichaDe(b.id, prof)
    const serv = await makeService(b.id)
    const cli = await makeCustomer(b.id)
    await makeAppointment(b.id, { customerId: cli.id, professionalId: ficha.id, serviceId: serv.id, startsAt: new Date('2026-11-18T15:00:00Z') })
    const e = await domainError(removeProfessional(gerente, ficha.id))
    expect(e.reason).toBe('has_future_appointments')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(prof).membershipId } })).active).toBe(true)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).archivedAt).toBeNull()
  })

  test('caso feliz: arquiva a ficha, desliga o vínculo e desativa o acesso, de uma vez', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER', { now: AGORA })
    const prof = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
    const ficha = await fichaDe(b.id, prof)
    await removeProfessional(gerente, ficha.id)
    expect(await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).toMatchObject({ membershipId: null })
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).archivedAt).not.toBeNull()
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: memberOf(prof).membershipId } })).active).toBe(false)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'professional.archived', targetId: ficha.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'team.member_deactivated' } })).toBe(1)
  })

  test('ficha sem acesso: só arquiva; remover de novo não faz nada', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const ficha = await makeProfessional(b.id, { name: 'Sem acesso' })
    await removeProfessional(dono, ficha.id)
    await removeProfessional(dono, ficha.id)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).archivedAt).not.toBeNull()
  })
})

describe('editar serviço com a duração fora da grade', () => {
  test('mudar só o nome funciona; mudar a duração para fora da grade continua recusado', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const s = await createService(dono, { name: 'Banho', icon: 'sparkles', priceCents: 5000, durationMin: 20 })
    const ok = await updateService(dono, s.id, { name: 'Banho completo', durationMin: 20 }, { onGrid: true })
    expect(ok.name).toBe('Banho completo')
    const e = await domainError(updateService(dono, s.id, { durationMin: 25 }, { onGrid: true }))
    expect(e.fields?.durationMin).toBeTruthy()
    expect((await prisma.service.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(20)
  })
})

describe('clientes', () => {
  test('busca com NUL não derruba: devolve lista (vazia) sem erro', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    await makeCustomer(b.id, { name: 'Abel' })
    const r = await listCustomers(dono, { search: 'ab\u0000' })
    expect(r.items.map((c) => c.name)).toEqual(['Abel'])
    expect((await listCustomers(dono, { search: '\u0000\u0000' })).items).toHaveLength(1)
  })

  test('a lista de arquivados não mostra anonimizado; e a visão diz quem foi removido', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const arquivado = await makeCustomer(b.id, { name: 'Arquivada' })
    const removido = await makeCustomer(b.id, { name: 'Removida', email: 'r@exemplo.com' })
    const homonimo = await makeCustomer(b.id, { name: 'Cliente removido' })
    await archiveCustomer(dono, arquivado.id)
    await archiveCustomer(dono, homonimo.id)
    await anonymizeCustomer(dono, removido.id)
    const lista = await listCustomers(dono, { onlyArchived: true })
    expect(lista.items.map((c) => c.name).sort()).toEqual(['Arquivada', 'Cliente removido'])
    expect(await isCustomerAnonymized(dono, homonimo.id)).toBe(false)
    expect(await isCustomerAnonymized(dono, removido.id)).toBe(true)
    expect(await isCustomerAnonymized(dono, arquivado.id)).toBe(false)
  })

  test('o profissional vê, no histórico do cliente, só os atendimentos dele', async () => {
    const b = await makeBusiness()
    const serv = await makeService(b.id)
    const eu = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
    const ficha = await fichaDe(b.id, eu, 'Eu')
    const colega = await makeProfessional(b.id, { name: 'Colega' })
    const cli = await makeCustomer(b.id, { name: 'Marina' })
    await makeAppointment(b.id, { customerId: cli.id, professionalId: ficha.id, serviceId: serv.id, startsAt: new Date('2026-11-18T15:00:00Z') })
    await makeAppointment(b.id, { customerId: cli.id, professionalId: colega.id, serviceId: serv.id, startsAt: new Date('2026-11-19T15:00:00Z') })
    await makeAppointment(b.id, { customerId: cli.id, professionalId: colega.id, serviceId: serv.id, startsAt: new Date('2026-11-10T15:00:00Z'), status: 'COMPLETED' })
    await makeAppointment(b.id, { customerId: cli.id, professionalId: ficha.id, serviceId: serv.id, startsAt: new Date('2026-11-09T15:00:00Z'), status: 'COMPLETED' })
    const futuros = await listCustomerAppointments(eu, { customerId: cli.id, scope: 'upcoming' })
    expect(futuros.items.map((a) => a.professional.name)).toEqual(['Eu'])
    const passados = await listCustomerAppointments(eu, { customerId: cli.id, scope: 'past' })
    expect(passados.items.map((a) => a.professional.name)).toEqual(['Eu'])
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    expect((await listCustomerAppointments(dono, { customerId: cli.id, scope: 'upcoming' })).items).toHaveLength(2)
    // Acesso sem ficha ligada não vê atendimento nenhum.
    const solto = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
    expect((await listCustomerAppointments(solto, { customerId: cli.id, scope: 'upcoming' })).items).toHaveLength(0)
  })
})

describe('foto do profissional', () => {
  test('duas trocas ao mesmo tempo não deixam arquivo órfão', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
    const ficha = await makeProfessional(b.id, { name: 'Ana' })
    const png = async (cor: string) => ({ bytes: new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: cor } }).png().toBuffer()) })
    await setProfessionalAvatar(dono, ficha.id, await png('#0e4f5c'))
    await Promise.all([setProfessionalAvatar(dono, ficha.id, await png('#aa0000')), setProfessionalAvatar(dono, ficha.id, await png('#00aa00'))])
    expect(await prisma.upload.count({ where: { businessId: b.id } })).toBe(1)
    const atual = await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })
    expect(await prisma.upload.findUniqueOrThrow({ where: { id: atual.avatarUploadId ?? '' } })).toBeTruthy()
  })
})

void makeMembership
void makeUser
