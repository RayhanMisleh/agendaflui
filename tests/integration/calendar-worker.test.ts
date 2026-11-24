import { afterEach, describe, expect, test, vi } from 'vitest'
import { setAfterScheduler } from '@/server/after'
import { calendarEventId } from '@/server/calendar/event'
import { sealCalendarToken } from '@/server/calendar/token'
import { processCalendarSyncs } from '@/server/calendar/worker'
import { connectCalendar, disconnectCalendar } from '@/server/calendar/connection'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { saveGoogleSettings } from '@/server/domain/platform/google-settings'
import { alterarVinculo } from '@/server/domain/platform/access-core'
import { bookAppointment, cancelAppointment, completeAppointment, markNoShow, rescheduleAppointment, undoOutcome } from '@/server/domain/scheduling/appointments'
import { updateProfessional } from '@/server/domain/team/professionals'
import { IntegrationError, setIntegrationsForTests } from '@/server/integrations'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import {
  ctxWithRole,
  makeBusiness,
  makeCalendarConnection,
  makeCtx,
  makeCustomer,
  makeMembership,
  makePet,
  makePlatformAdmin,
  makeProfessional,
  makeService,
  makeUser,
  makeWorkingHours,
} from '../setup/factories'

const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const SEGREDO = 'GOCSPX-abcdef0123456789Qz7K'
/** Segunda-feira, 08:00 em São Paulo. */
const AGORA = new Date('2026-11-16T11:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))
const google = fakeGoogleAuthority()

afterEach(() => {
  setIntegrationsForTests(null)
  setAfterScheduler(undefined)
  vi.restoreAllMocks()
})

async function montar(o: { semGoogle?: boolean; semLigacao?: boolean } = {}) {
  await resetDb()
  google.reset()
  setIntegrationsForTests(null)
  if (!o.semGoogle) {
    const a = await makePlatformAdmin()
    await saveGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name }, { clientId: ID, clientSecret: SEGREDO }, 0, AGORA)
  }
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1080 }])
  const pessoa = await makeUser()
  const vinculo = await makeMembership(b.id, pessoa.id, 'PROFESSIONAL')
  await prisma.professional.update({ where: { id: ana.id }, data: { membershipId: vinculo.id } })
  if (!o.semLigacao) await makeCalendarConnection(pessoa.id, { googleSub: 'g-ana' })
  const gerente = await makeCtx(b, { now: AGORA })
  return { b, banho, ana, pessoa, vinculo, gerente }
}

type S = Awaited<ReturnType<typeof montar>>

const marcar = async (s: S, startsAt = hora(10), customerId?: string) =>
  bookAppointment(s.gerente, { customerId: customerId ?? (await makeCustomer(s.b.id)).id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt })

const rodar = (now = AGORA) => processCalendarSyncs({ now })
const linha = (appointmentId: string) => prisma.calendarSync.findUniqueOrThrow({ where: { appointmentId } })
const agenda = (sub = 'g-ana') => google.calendarOf(sub)
const chamadas = (op: string) => google.calls.filter((c) => c.op === op)

describe('reconciliação', () => {
  test('marcado → um evento na agenda da pessoa com o título e o id determinísticos; rodar de novo não chama o Google', async () => {
    const s = await montar()
    const cliente = await makeCustomer(s.b.id, { name: 'Marina Souza' })
    const v = await marcar(s, hora(10), cliente.id)
    expect(await rodar()).toMatchObject({ upserted: 1, deleted: 0, failed: 0 })
    const evento = agenda().get(calendarEventId(v.id))
    expect(evento?.summary).toBe('Banho · Marina Souza')
    expect(evento?.start).toEqual({ dateTime: '2026-11-16T10:00:00-03:00', timeZone: 'America/Sao_Paulo' })
    expect(evento?.description).toMatch(/Abrir no painel: http\S+\/painel\/agenda\?data=2026-11-16&ag=/)
    expect(agenda().size).toBe(1)
    expect(await linha(v.id)).toMatchObject({ generation: 1, syncedGeneration: 1, placedUserId: s.pessoa.id, attempts: 0, lockedBy: null })
    expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { userId: s.pessoa.id } })).lastSyncedAt).not.toBeNull()

    const antes = google.calls.length
    expect(await rodar()).toMatchObject({ upserted: 0, deleted: 0 })
    expect(google.calls.length).toBe(antes)
  })

  test('com pet: título "Banho · Rex (Cão médio)"; gato: "Mia (Gato)"', async () => {
    const s = await montar()
    await prisma.business.update({ where: { id: s.b.id }, data: { niche: 'PET' } })
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { nicheOptions: { servesCats: true } } })
    const cliente = await makeCustomer(s.b.id, { name: 'Marina Souza' })
    const rex = await makePet(s.b.id, cliente.id, { name: 'Rex', species: 'DOG', size: 'MEDIUM' })
    const mia = await makePet(s.b.id, cliente.id, { name: 'Mia', species: 'CAT', size: null })
    const base = { customerId: cliente.id, professionalId: s.ana.id, serviceIds: [s.banho.id] }
    const a = await bookAppointment(s.gerente, { ...base, petId: rex.id, startsAt: hora(10) })
    const b = await bookAppointment(s.gerente, { ...base, petId: mia.id, startsAt: hora(14) })
    await rodar()
    expect(agenda().get(calendarEventId(a.id))?.summary).toBe('Banho · Rex (Cão médio)')
    expect(agenda().get(calendarEventId(b.id))?.summary).toBe('Banho · Mia (Gato)')
  })

  test('cancelado e faltou apagam; concluído fica; desfazer recria com o mesmo id', async () => {
    const s = await montar()
    const depois = await makeCtx(s.b, { now: hora(12) })
    const v = await marcar(s)
    await rodar()
    expect(agenda().has(calendarEventId(v.id))).toBe(true)
    await completeAppointment(depois, v.id)
    await rodar()
    expect(agenda().get(calendarEventId(v.id))).toBeDefined()
    await undoOutcome(depois, v.id)
    await markNoShow(depois, v.id)
    await rodar()
    expect(agenda().size).toBe(0)
    expect((await linha(v.id)).placedUserId).toBeNull()
    await undoOutcome(depois, v.id)
    await rodar()
    expect(agenda().has(calendarEventId(v.id))).toBe(true)
    await cancelAppointment(s.gerente, v.id)
    await rodar()
    expect(agenda().size).toBe(0)
    expect(chamadas('delete').length).toBeGreaterThanOrEqual(2)
  })

  test('mudança durante o envio volta na rodada seguinte', async () => {
    const s = await montar()
    const v = await marcar(s)
    let remarcou = false
    setIntegrationsForTests({
      google: {
        ...google,
        upsertEvent: async (i) => {
          if (!remarcou) {
            remarcou = true
            await rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) })
          }
          return google.upsertEvent(i)
        },
      },
    })
    await rodar()
    expect(await linha(v.id)).toMatchObject({ generation: 2, syncedGeneration: 1 })
    expect(agenda().get(calendarEventId(v.id))?.start.dateTime).toBe('2026-11-16T10:00:00-03:00')
    await rodar()
    expect(await linha(v.id)).toMatchObject({ generation: 2, syncedGeneration: 2 })
    expect(agenda().get(calendarEventId(v.id))?.start.dateTime).toBe('2026-11-16T14:00:00-03:00')
    expect(agenda().size).toBe(1)
  })

  test('duas rodadas em paralelo nunca mandam a mesma linha', async () => {
    const s = await montar()
    for (const h of [9, 10, 11, 13, 14, 15]) await marcar(s, hora(h))
    const [a, b] = await Promise.all([rodar(), rodar()])
    expect(a.upserted + b.upserted).toBe(6)
    const ids = chamadas('upsert').map((c) => c.eventId)
    expect(new Set(ids).size).toBe(6)
    expect(ids).toHaveLength(6)
  })

  test('pessoa sem ligação: nada no Google e a linha fica sincronizada', async () => {
    const s = await montar({ semLigacao: true })
    const v = await marcar(s)
    await rodar()
    expect(google.calls).toEqual([])
    expect(await linha(v.id)).toMatchObject({ syncedGeneration: 1, placedUserId: null })
  })

  test('anonimizado: o evento é reescrito com "Cliente removido" e sem observação', async () => {
    const s = await montar()
    const depois = await makeCtx(s.b, { now: hora(12) })
    const cliente = await makeCustomer(s.b.id, { name: 'Marina Souza' })
    const v = await marcar(s, hora(10), cliente.id)
    await prisma.appointment.update({ where: { id: v.id }, data: { customerNote: 'Tem medo de secador' } })
    await completeAppointment(depois, v.id)
    await rodar()
    expect(agenda().get(calendarEventId(v.id))?.description).toContain('Tem medo de secador')
    await anonymizeCustomer(depois, cliente.id)
    await rodar()
    const evento = agenda().get(calendarEventId(v.id))
    expect(evento?.summary).toBe('Banho · Cliente removido')
    expect(evento?.description).not.toContain('Tem medo')
    expect(evento?.description).not.toContain('Marina')
  })

  test('sem as chaves do Google configuradas a linha espera 15 min sem contar tentativa', async () => {
    const s = await montar({ semGoogle: true })
    const v = await marcar(s)
    expect(await rodar()).toMatchObject({ skipped: 1, retried: 0 })
    const l = await linha(v.id)
    expect(l).toMatchObject({ attempts: 0, syncedGeneration: 0, lockedBy: null })
    expect(l.nextAttemptAt?.getTime()).toBe(addMinutes(AGORA, 15).getTime())
  })
})

describe('falhas do Google', () => {
  test('503 três vezes: esperas de 1, 5 e 15 min; na 6ª falha para com failed_at; remarcar revive', async () => {
    const s = await montar()
    const v = await marcar(s)
    google.failNext('upsert', 'unavailable', 20)
    let t = AGORA
    const esperas = [1, 5, 15, 60, 240]
    for (const [i, minutos] of esperas.entries()) {
      const r = await rodar(t)
      expect(r.retried, `tentativa ${i + 1}`).toBe(1)
      const l = await linha(v.id)
      expect(l).toMatchObject({ attempts: i + 1, failedAt: null, lastError: 'unavailable', syncedGeneration: 0 })
      expect(l.nextAttemptAt?.getTime()).toBe(addMinutes(t, minutos).getTime())
      // Antes da hora, nada acontece.
      const antes = chamadas('upsert').length
      await rodar(addMinutes(t, minutos - 0.5))
      expect(chamadas('upsert').length).toBe(antes)
      t = addMinutes(t, minutos)
    }
    expect((await rodar(t)).failed).toBe(1)
    expect(await linha(v.id)).toMatchObject({ attempts: 6, syncedGeneration: 0 })
    expect((await linha(v.id)).failedAt).not.toBeNull()
    const parou = chamadas('upsert').length
    await rodar(addMinutes(t, 1000))
    expect(chamadas('upsert').length).toBe(parou)

    google.reset()
    await rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) })
    expect(await linha(v.id)).toMatchObject({ attempts: 0, failedAt: null })
    await rodar(addMinutes(t, 1001))
    expect(agenda().size).toBe(1)
    expect((await linha(v.id)).syncedGeneration).toBe(2)
  })

  test('timeout do Google: só a primeira linha da pessoa tenta; as outras esperam sem contar tentativa', async () => {
    const s = await montar()
    const [a, b] = [await marcar(s, hora(9)), await marcar(s, hora(10))]
    google.failNext('upsert', 'timeout', 20)
    expect(await rodar()).toMatchObject({ retried: 1, skipped: 1 })
    expect(chamadas('upsert')).toHaveLength(1)
    const ls = [await linha(a.id), await linha(b.id)]
    expect(ls.map((l) => l.attempts).sort()).toEqual([0, 1])
    expect(ls.every((l) => l.lockedBy === null && l.syncedGeneration === 0)).toBe(true)
  })

  test('sem tempo na rodada: as linhas voltam sem tentativa e sem chamar o Google', async () => {
    const s = await montar()
    const [a, b] = [await marcar(s, hora(9)), await marcar(s, hora(10))]
    expect(await processCalendarSyncs({ now: AGORA, budgetMs: 0 })).toMatchObject({ skipped: 2, upserted: 0 })
    expect(google.calls).toHaveLength(0)
    for (const v of [a, b]) expect(await linha(v.id)).toMatchObject({ attempts: 0, syncedGeneration: 0, lockedBy: null, lockedUntil: null })
    expect(await rodar()).toMatchObject({ upserted: 2 })
  })

  test('429 numa linha deixa as outras da mesma pessoa para depois sem contar tentativa', async () => {
    const s = await montar()
    const [a, b, c] = [await marcar(s, hora(9)), await marcar(s, hora(10)), await marcar(s, hora(11))]
    google.failNext('upsert', 'rate_limited', 1)
    const r = await rodar()
    expect(r).toMatchObject({ upserted: 0, retried: 0, failed: 0, skipped: 3 })
    expect(chamadas('upsert')).toHaveLength(1)
    for (const v of [a, b, c]) {
      const l = await linha(v.id)
      expect(l).toMatchObject({ attempts: 0, syncedGeneration: 0, lockedBy: null, failedAt: null })
      expect(l.nextAttemptAt?.getTime()).toBe(addMinutes(AGORA, 1).getTime())
    }
    expect((await rodar(addMinutes(AGORA, 2))).upserted).toBe(3)
  })

  test('invalid_grant: ligação REVOKED, sem token, linha sincronizada sem agir, as outras da pessoa nem tentam', async () => {
    const s = await montar()
    const [a, b] = [await marcar(s, hora(9)), await marcar(s, hora(10))]
    google.failNext('refresh', 'revoked', 1)
    const r = await rodar()
    expect(r.revoked).toBe(1)
    const con = await prisma.calendarConnection.findUniqueOrThrow({ where: { userId: s.pessoa.id } })
    expect(con).toMatchObject({ status: 'REVOKED', refreshTokenEnc: null })
    expect(con.revokedAt).not.toBeNull()
    expect(chamadas('refresh')).toHaveLength(1)
    expect(chamadas('upsert')).toHaveLength(0)
    for (const v of [a, b]) expect(await linha(v.id)).toMatchObject({ generation: 1, syncedGeneration: 1, attempts: 0, failedAt: null })
  })

  test('selo do token que não abre: ligação REVOKED (a tela pede para religar), sem chamar o Google', async () => {
    const s = await montar()
    const v = await marcar(s)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const outro = sealCalendarToken('outra-pessoa', 'rt-x')
    await prisma.calendarConnection.update({ where: { userId: s.pessoa.id }, data: { refreshTokenEnc: outro } })
    expect((await rodar()).revoked).toBe(1)
    expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { userId: s.pessoa.id } })).toMatchObject({ status: 'REVOKED', refreshTokenEnc: null })
    expect(google.calls).toHaveLength(0)
    expect(await linha(v.id)).toMatchObject({ syncedGeneration: 1 })
  })

  test('token de acesso recusado no evento (permissão retirada) também desliga a ligação', async () => {
    const s = await montar()
    const v = await marcar(s)
    google.failNext('upsert', 'revoked', 1)
    expect((await rodar()).revoked).toBe(1)
    expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { userId: s.pessoa.id } })).status).toBe('REVOKED')
    expect(await linha(v.id)).toMatchObject({ syncedGeneration: 1 })
  })

  test('revogação não desfaz uma religação feita no meio da rodada', async () => {
    const s = await montar()
    const v = await marcar(s)
    const novo = sealCalendarToken(s.pessoa.id, 'rt-g-ana-2')
    setIntegrationsForTests({
      google: {
        ...google,
        refreshAccessToken: async () => {
          await prisma.calendarConnection.update({ where: { userId: s.pessoa.id }, data: { refreshTokenEnc: novo } })
          throw new IntegrationError('revoked', 'recusado')
        },
      },
    })
    expect((await rodar()).revoked).toBe(0)
    expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { userId: s.pessoa.id } })).toMatchObject({ status: 'CONNECTED', refreshTokenEnc: novo })
    expect(await linha(v.id)).toMatchObject({ syncedGeneration: 1 })
  })
})

describe('cancelado com a agenda desligada', () => {
  test('desligou, cancelou, religou: o evento que ficou no Google é apagado', async () => {
    const s = await montar()
    await prisma.user.update({ where: { id: s.pessoa.id }, data: { googleSub: 'g-ana', googleEmail: 'ana@exemplo.test', googleLinkedAt: AGORA } })
    const v = await marcar(s)
    await rodar()
    expect(agenda().has(calendarEventId(v.id))).toBe(true)
    setAfterScheduler(() => undefined)
    await disconnectCalendar(s.pessoa.id)
    await cancelAppointment(s.gerente, v.id)
    await rodar()
    expect(agenda().has(calendarEventId(v.id))).toBe(true)
    await connectCalendar({ userId: s.pessoa.id, googleSub: 'g-ana', refreshToken: 'rt-g-ana-2', now: AGORA })
    await rodar()
    expect(agenda().size).toBe(0)
    expect(await linha(v.id)).toMatchObject({ placedUserId: null, attempts: 0 })
  })
})

describe('o evento muda de dono', () => {
  test('profissional religado a outra pessoa: apaga da agenda antiga e cria na nova', async () => {
    const s = await montar()
    const dona = await ctxWithRole(s.b, 'OWNER', { now: AGORA })
    const outra = await makeUser()
    const m2 = await makeMembership(s.b.id, outra.id, 'PROFESSIONAL')
    await makeCalendarConnection(outra.id, { googleSub: 'g-bia' })
    const v = await marcar(s)
    await rodar()
    expect(agenda('g-ana').size).toBe(1)
    await updateProfessional(dona, s.ana.id, { membershipId: m2.id })
    await rodar()
    expect(agenda('g-ana').size).toBe(0)
    expect(agenda('g-bia').has(calendarEventId(v.id))).toBe(true)
    expect((await linha(v.id)).placedUserId).toBe(outra.id)
  })

  test('vínculo desativado: apaga da agenda e não recria; reativado, volta', async () => {
    const s = await montar()
    const dona = await ctxWithRole(s.b, 'OWNER', { now: AGORA })
    const autor = { kind: 'conta', ctx: dona } as const
    const v = await marcar(s)
    await rodar()
    expect(agenda().size).toBe(1)
    await alterarVinculo(autor, s.b.id, s.vinculo.id, (a) => ({ role: a.role, active: false }), AGORA)
    await rodar()
    expect(agenda().size).toBe(0)
    expect((await linha(v.id)).placedUserId).toBeNull()
    await alterarVinculo(autor, s.b.id, s.vinculo.id, (a) => ({ role: a.role, active: true }), AGORA)
    await rodar()
    expect(agenda().has(calendarEventId(v.id))).toBe(true)
  })
})
