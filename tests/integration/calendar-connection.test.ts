import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setAfterScheduler } from '@/server/after'
import { confirmEmailChange, requestEmailChange, unlinkGoogle } from '@/server/auth/person-account'
import { connectCalendar, disconnectCalendar, getCalendarStatus } from '@/server/calendar/connection'
import { prisma } from '@/server/db/client'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeAppointment, makeBusiness, makeCalendarConnection, makeCustomer, makeMembership, makeProfessional, makeService, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const AGORA = new Date('2026-11-24T12:00:00.000Z')
const SENHA = 'senha-atual-bem-longa'
const GOOGLE = { sub: 'g-rita', email: 'rita@exemplo.test' }
const google = fakeGoogleAuthority()
const mail = fakeMail()
let tarefas: (() => Promise<void>)[]

beforeEach(async () => {
  await resetDb()
  google.reset()
  mail.install()
  tarefas = []
  setAfterScheduler((t) => {
    tarefas.push(t)
  })
})
afterEach(() => {
  mail.uninstall()
  setAfterScheduler(undefined)
})

const depois = async (): Promise<void> => {
  for (const t of tarefas.splice(0)) await t()
}

/** Pessoa da equipe com Google, senha e a agenda ligada, mais um agendamento já colocado na agenda dela. */
async function ligada() {
  const u = await makeUser({ email: GOOGLE.email, password: SENHA, google: GOOGLE })
  const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'PROFESSIONAL')
  const p = await makeProfessional(b.id, { membershipId: m.id })
  const s = await makeService(b.id)
  const ag = await makeAppointment(b.id, { customerId: (await makeCustomer(b.id)).id, professionalId: p.id, serviceId: s.id, startsAt: new Date('2026-12-01T12:00:00Z') })
  await makeCalendarConnection(u.id, { googleSub: GOOGLE.sub, refreshToken: 'rt-g-rita-3' })
  await prisma.calendarSync.create({ data: { businessId: b.id, appointmentId: ag.id, generation: 1, syncedGeneration: 1, placedUserId: u.id } })
  return { u, ag }
}

describe('desligar', () => {
  test('desligar apaga a ligação, anula placed_user_id e chama revokeToken depois do commit', async () => {
    const { u, ag } = await ligada()
    await disconnectCalendar(u.id)
    expect(await prisma.calendarConnection.count()).toBe(0)
    expect((await prisma.calendarSync.findUniqueOrThrow({ where: { appointmentId: ag.id } })).placedUserId).toBeNull()
    expect(google.calls).toEqual([])
    await depois()
    expect(google.calls).toEqual([{ op: 'revoke', sub: 'g-rita' }])
  })

  test('desligar sem ligação não faz nada', async () => {
    const u = await makeUser({ password: SENHA })
    await disconnectCalendar(u.id)
    await depois()
    expect(google.calls).toEqual([])
  })

  test('desvincular o Google desliga a agenda na mesma transação', async () => {
    const { u, ag } = await ligada()
    await unlinkGoogle(u.id, AGORA)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub).toBeNull()
    expect(await prisma.calendarConnection.count()).toBe(0)
    expect((await prisma.calendarSync.findUniqueOrThrow({ where: { appointmentId: ag.id } })).placedUserId).toBeNull()
    await depois()
    expect(google.calls).toEqual([{ op: 'revoke', sub: 'g-rita' }])
  })

  test('trocar o e-mail para outro que não o do Google desliga a agenda; para o do Google, não', async () => {
    const { u } = await ligada()
    await (await requestEmailChange(u.id, { email: 'novo@exemplo.test' }, AGORA))()
    const r = await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: mail.codeOf() }, AGORA)
    expect(r.googleUnlinked).toBe(true)
    expect(await prisma.calendarConnection.count()).toBe(0)

    const v = await makeUser({ email: 'velho@exemplo.test', password: SENHA, google: { sub: 'g-v', email: 'v@exemplo.test' } })
    await makeCalendarConnection(v.id, { googleSub: 'g-v' })
    await prisma.emailCode.deleteMany()
    await (await requestEmailChange(v.id, { email: 'V@exemplo.test' }, AGORA))()
    expect((await confirmEmailChange(v.id, { email: 'v@exemplo.test', code: mail.codeOf() }, AGORA)).googleUnlinked).toBe(false)
    expect(await prisma.calendarConnection.count({ where: { userId: v.id } })).toBe(1)
  })
})

describe('ligar', () => {
  test('connectCalendar com sub diferente do vinculado: conflict', async () => {
    const u = await makeUser({ password: SENHA, google: GOOGLE })
    const e = await domainError(connectCalendar({ userId: u.id, googleSub: 'g-outro', refreshToken: 'rt-x-1', now: AGORA }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('calendar_wrong_google')
    expect(await prisma.calendarConnection.count()).toBe(0)
  })

  test('liga e enfileira só os futuros do profissional do vínculo ativo', async () => {
    const u = await makeUser({ password: SENHA, google: GOOGLE })
    const b = await makeBusiness()
    const m = await makeMembership(b.id, u.id, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: m.id })
    const outro = await makeProfessional(b.id)
    const s = await makeService(b.id)
    const c = await makeCustomer(b.id)
    const futuro = await makeAppointment(b.id, { customerId: c.id, professionalId: meu.id, serviceId: s.id, startsAt: new Date('2026-12-01T12:00:00Z') })
    const passado = await makeAppointment(b.id, { customerId: c.id, professionalId: meu.id, serviceId: s.id, startsAt: new Date('2026-11-01T12:00:00Z') })
    const deOutro = await makeAppointment(b.id, { customerId: c.id, professionalId: outro.id, serviceId: s.id, startsAt: new Date('2026-12-01T12:00:00Z') })
    const r = await connectCalendar({ userId: u.id, googleSub: GOOGLE.sub, refreshToken: 'rt-g-rita-1', now: AGORA })
    expect(r.queued).toBe(1)
    expect(await prisma.calendarSync.findMany({ select: { appointmentId: true } })).toEqual([{ appointmentId: futuro.id }])
    expect([passado.id, deOutro.id]).not.toContain(futuro.id)
  })

  test('religar com o mesmo token não revoga nada', async () => {
    const u = await makeUser({ password: SENHA, google: GOOGLE })
    await connectCalendar({ userId: u.id, googleSub: GOOGLE.sub, refreshToken: 'rt-g-rita-1', now: AGORA })
    await connectCalendar({ userId: u.id, googleSub: GOOGLE.sub, refreshToken: 'rt-g-rita-2', now: AGORA })
    await depois()
    expect(google.calls).toEqual([{ op: 'revoke', sub: 'g-rita' }])
  })
})

describe('estado', () => {
  test('getCalendarStatus: off, on e revoked', async () => {
    const u = await makeUser({ password: SENHA })
    expect(await getCalendarStatus(u.id)).toEqual({ state: 'off', connectedAt: null, lastSyncedAt: null })
    await makeCalendarConnection(u.id)
    expect((await getCalendarStatus(u.id)).state).toBe('on')
    await prisma.calendarConnection.update({ where: { userId: u.id }, data: { status: 'REVOKED', refreshTokenEnc: null, revokedAt: AGORA } })
    expect((await getCalendarStatus(u.id)).state).toBe('revoked')
  })
})
