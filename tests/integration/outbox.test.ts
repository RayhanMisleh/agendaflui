import { prisma } from '@/server/db/client'
import type { NotificationKind } from '@/server/db/generated/client'
import { anonymizeCustomer, archiveCustomer } from '@/server/domain/customers/customers'
import { cancelPendingForCustomer, enqueueAppointmentEvent, notifyProfessionalFreeEarly } from '@/server/domain/notifications/outbox'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  markNoShow,
  rescheduleAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import {
  getNotificationSettings,
  updateNotificationSettings,
} from '@/server/domain/settings/notification-settings'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeMembership,
  makeProfessional,
  makeService,
  makeUser,
  makeWorkingHours,
} from '../setup/factories'

beforeEach(resetDb)

const MANHA = { startMin: 540, endMin: 720 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
/** Segunda-feira, 10:00 em São Paulo. */
const SEGUNDA_10H = new Date('2026-11-16T13:00:00Z')
/** Quinta-feira, 10:00 em São Paulo (3 dias depois). */
const QUINTA_10H = new Date('2026-11-19T13:00:00Z')
const QUINTA_11H = new Date('2026-11-19T14:00:00Z')

async function montar(o: { now?: Date; comVinculo?: boolean; autoConfirm?: boolean } = {}) {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30, minLeadMin: 0, ...(o.autoConfirm === false ? { autoConfirm: false } : {}) } })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const user = await makeUser()
  const vinculo = await makeMembership(b.id, user.id, 'PROFESSIONAL')
  const ana = await makeProfessional(b.id, {
    name: 'Ana',
    serviceIds: [tosa.id],
    ...(o.comVinculo === false ? {} : { membershipId: vinculo.id }),
  })
  for (const dia of ['MONDAY', 'THURSDAY'] as const) await makeWorkingHours(b.id, ana.id, dia, [MANHA])
  const now = o.now ?? SEGUNDA_08H
  const gerente = await makeCtx(b, { now })
  const cliente = await makeCustomer(b.id)
  const clienteCtx = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name }, now })
  return { b, tosa, ana, vinculo, gerente, cliente, clienteCtx, now }
}

const fila = (businessId: string, where: Record<string, unknown> = {}) =>
  prisma.notification.findMany({ where: { businessId, ...where }, orderBy: [{ kind: 'asc' }, { channel: 'asc' }] })

const resumo = (rows: { kind: string; channel: string; status: string }[]) =>
  rows.map((r) => `${r.kind}/${r.channel}/${r.status}`).sort()

const ambos = (kind: string, status = 'PENDING') => [`${kind}/EMAIL/${status}`]

describe('fila ao marcar', () => {
  test('pelo cliente com 3 dias: confirmação, aviso de equipe e os dois lembretes nos horários exatos', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const rows = await fila(s.b.id)
    expect(resumo(rows)).toEqual(
      [
        ...ambos('APPOINTMENT_CONFIRMED'),
        ...ambos('STAFF_NEW_APPOINTMENT'),
        ...ambos('APPOINTMENT_REMINDER_24H'),
        ...ambos('APPOINTMENT_REMINDER_1H'),
      ].sort(),
    )
    const por = (kind: string, channel = 'EMAIL') => rows.find((r) => r.kind === kind && r.channel === channel)
    expect(por('APPOINTMENT_CONFIRMED')?.customerId).toBe(s.cliente.id)
    expect(por('APPOINTMENT_CONFIRMED')?.membershipId).toBeNull()
    expect(por('APPOINTMENT_CONFIRMED')?.scheduledFor.toISOString()).toBe(SEGUNDA_08H.toISOString())
    expect(por('STAFF_NEW_APPOINTMENT')?.membershipId).toBe(s.vinculo.id)
    expect(por('STAFF_NEW_APPOINTMENT')?.customerId).toBeNull()
    expect(por('APPOINTMENT_REMINDER_24H')?.scheduledFor.toISOString()).toBe('2026-11-18T13:00:00.000Z')
    expect(por('APPOINTMENT_REMINDER_1H')?.scheduledFor.toISOString()).toBe('2026-11-19T12:00:00.000Z')
    expect(por('APPOINTMENT_REMINDER_1H')?.customerId).toBe(s.cliente.id)
    expect(rows.every((r) => r.appointmentId === v.id && r.status === 'PENDING' && r.attempts === 0)).toBe(true)
    expect(por('APPOINTMENT_CONFIRMED')?.dedupeKey).toBe(`APPOINTMENT_CONFIRMED:EMAIL:${v.id}:${QUINTA_10H.getTime()}`)
    expect(por('STAFF_NEW_APPOINTMENT')?.dedupeKey).toBe(`STAFF_NEW_APPOINTMENT:EMAIL:${v.id}`)
  })

  test('o payload leva só identificadores e o instante', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    for (const r of await fila(s.b.id)) {
      expect(r.payload).toEqual({ appointmentId: v.id, startsAt: '2026-11-19T13:00:00.000Z' })
    }
  })

  test('daqui a 2 h cria só o lembrete de 1 h', async () => {
    const s = await montar()
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: SEGUNDA_10H })
    const lembretes = await fila(s.b.id, { kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } })
    expect(resumo(lembretes)).toEqual(ambos('APPOINTMENT_REMINDER_1H'))
    expect(lembretes[0]?.scheduledFor.toISOString()).toBe('2026-11-16T12:00:00.000Z')
  })

  test('daqui a 30 min não cria lembrete algum', async () => {
    const s = await montar({ now: new Date('2026-11-16T12:30:00Z') })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: SEGUNDA_10H })
    expect(await fila(s.b.id, { kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } })).toHaveLength(0)
    expect(resumo(await fila(s.b.id))).toEqual([...ambos('APPOINTMENT_CONFIRMED'), ...ambos('STAFF_NEW_APPOINTMENT')].sort())
  })

  test('pela equipe: cliente é avisado, equipe não', async () => {
    const s = await montar()
    await bookAppointment(s.gerente, { customerId: s.cliente.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const tipos = new Set((await fila(s.b.id)).map((r) => r.kind))
    expect(tipos).toEqual(new Set(['APPOINTMENT_CONFIRMED', 'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H']))
  })

  test('com o e-mail de confirmação desligado na conta, nada é gravado', async () => {
    const s = await montar()
    await updateNotificationSettings(s.gerente, { APPOINTMENT_CONFIRMED: { email: false } })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const confirmacoes = await fila(s.b.id, { kind: 'APPOINTMENT_CONFIRMED' })
    expect(confirmacoes).toHaveLength(0)
  })

  test('tipo desligado não grava nada', async () => {
    const s = await montar()
    await updateNotificationSettings(s.gerente, { STAFF_NEW_APPOINTMENT: { email: false } })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    expect(await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })).toHaveLength(0)
  })

  test('profissional sem vínculo não gera aviso de equipe', async () => {
    const s = await montar({ comVinculo: false })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    expect(await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })).toHaveLength(0)
    expect(await fila(s.b.id, { kind: 'APPOINTMENT_CONFIRMED' })).toHaveLength(1)
  })

  test('marcação que falha por horário ocupado não deixa linha na fila', async () => {
    const s = await montar()
    await bookAppointment(s.gerente, { customerId: s.cliente.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const antes = await prisma.notification.count({ where: { businessId: s.b.id } })
    const outro = await makeCustomer(s.b.id)
    const erro = await domainError(
      bookAppointment(s.gerente, { customerId: outro.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H }),
    )
    expect(erro.reason).toBe('slot_taken')
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(antes)
  })

  test('se a transação desfaz depois de enfileirar, a fila também volta', async () => {
    const s = await montar()
    const appt = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: QUINTA_10H })
    await expect(
      s.gerente.db.$transaction(async (tx) => {
        await enqueueAppointmentEvent(tx, s.gerente, 'booked', appt)
        throw new Error('desfaz')
      }),
    ).rejects.toThrow('desfaz')
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('enfileirar o mesmo evento duas vezes não duplica linhas', async () => {
    const s = await montar()
    const appt = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: QUINTA_10H })
    for (let i = 0; i < 2; i++) {
      await s.clienteCtx.db.$transaction((tx) => enqueueAppointmentEvent(tx, s.clienteCtx, 'booked', appt))
    }
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(4)
  })

  test('cliente arquivado ou anonimizado não recebe nada', async () => {
    const s = await montar()
    const appt = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: QUINTA_10H })
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { archivedAt: SEGUNDA_08H } })
    await s.gerente.db.$transaction((tx) => enqueueAppointmentEvent(tx, s.gerente, 'booked', appt))
    await s.gerente.db.$transaction((tx) => enqueueAppointmentEvent(tx, s.gerente, 'canceled', appt))
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(0)
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { archivedAt: null, anonymizedAt: SEGUNDA_08H } })
    await s.gerente.db.$transaction((tx) => enqueueAppointmentEvent(tx, s.gerente, 'completed', appt))
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(0)
  })
})

describe('fila ao cancelar, remarcar e concluir', () => {
  test('equipe cancela: lembretes pendentes cancelados e o cliente avisado', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await cancelAppointment(s.gerente, v.id)
    const rows = await fila(s.b.id)
    expect(resumo(rows.filter((r) => r.kind.startsWith('APPOINTMENT_REMINDER')))).toEqual(
      [...ambos('APPOINTMENT_REMINDER_24H', 'CANCELED'), ...ambos('APPOINTMENT_REMINDER_1H', 'CANCELED')].sort(),
    )
    expect(resumo(rows.filter((r) => r.kind === 'APPOINTMENT_CANCELED'))).toEqual(ambos('APPOINTMENT_CANCELED'))
    expect(rows.filter((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED')).toHaveLength(0)
    expect(rows.find((r) => r.kind === 'APPOINTMENT_CANCELED')?.customerId).toBe(s.cliente.id)
  })

  test('lembrete já enviado não é cancelado', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await prisma.notification.updateMany({ where: { appointmentId: v.id, kind: 'APPOINTMENT_REMINDER_24H' }, data: { status: 'SENT' } })
    await cancelAppointment(s.gerente, v.id)
    expect(resumo(await fila(s.b.id, { kind: 'APPOINTMENT_REMINDER_24H' }))).toEqual(ambos('APPOINTMENT_REMINDER_24H', 'SENT'))
  })

  test('cliente cancela: o membro do profissional é avisado, o cliente não', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await cancelAppointment(s.clienteCtx, v.id)
    const rows = await fila(s.b.id)
    expect(resumo(rows.filter((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED'))).toEqual(ambos('STAFF_APPOINTMENT_CANCELED'))
    expect(rows.find((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED')?.membershipId).toBe(s.vinculo.id)
    expect(rows.filter((r) => r.kind === 'APPOINTMENT_CANCELED')).toHaveLength(0)
    expect(rows.filter((r) => r.kind.startsWith('APPOINTMENT_REMINDER')).every((r) => r.status === 'CANCELED')).toBe(true)
  })

  test('equipe remarca: lembretes antigos cancelados, novos criados, cliente avisado com o instante anterior', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_11H })
    const rows = await fila(s.b.id)
    const lembretes = rows.filter((r) => r.kind.startsWith('APPOINTMENT_REMINDER'))
    expect(lembretes).toHaveLength(4)
    const pendentes = lembretes.filter((r) => r.status === 'PENDING')
    expect(resumo(pendentes)).toEqual([...ambos('APPOINTMENT_REMINDER_24H'), ...ambos('APPOINTMENT_REMINDER_1H')].sort())
    expect(pendentes.find((r) => r.kind === 'APPOINTMENT_REMINDER_24H')?.scheduledFor.toISOString()).toBe('2026-11-18T14:00:00.000Z')
    expect(pendentes.find((r) => r.kind === 'APPOINTMENT_REMINDER_1H')?.scheduledFor.toISOString()).toBe('2026-11-19T13:00:00.000Z')
    expect(lembretes.filter((r) => r.status === 'CANCELED')).toHaveLength(2)
    const aviso = rows.find((r) => r.kind === 'APPOINTMENT_RESCHEDULED' && r.channel === 'EMAIL')
    expect(aviso?.customerId).toBe(s.cliente.id)
    expect(aviso?.payload).toEqual({ appointmentId: v.id, startsAt: '2026-11-19T14:00:00.000Z', previousStartsAt: '2026-11-19T13:00:00.000Z' })
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: v.id } })
    expect(aviso?.dedupeKey).toBe(`APPOINTMENT_RESCHEDULED:EMAIL:${v.id}:${depois.updatedAt.getTime()}`)
    expect(rows.filter((r) => r.kind === 'STAFF_APPOINTMENT_RESCHEDULED')).toHaveLength(0)
  })

  test('cliente remarca: o membro é avisado', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.clienteCtx, v.id, { startsAt: QUINTA_11H })
    const rows = await fila(s.b.id)
    expect(resumo(rows.filter((r) => r.kind === 'STAFF_APPOINTMENT_RESCHEDULED'))).toEqual(ambos('STAFF_APPOINTMENT_RESCHEDULED'))
    expect(rows.filter((r) => r.kind === 'APPOINTMENT_RESCHEDULED')).toHaveLength(0)
  })

  test('remarcar sem mudar o horário (só o profissional) mantém os lembretes pendentes', async () => {
    const s = await montar()
    const caio = await makeProfessional(s.b.id, { name: 'Caio', serviceIds: [s.tosa.id] })
    await makeWorkingHours(s.b.id, caio.id, 'THURSDAY', [MANHA])
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_10H, professionalId: caio.id })
    const lembretes = await fila(s.b.id, { kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } })
    expect(lembretes).toHaveLength(2)
    expect(lembretes.every((r) => r.status === 'PENDING')).toBe(true)
  })

  test('voltar ao horário anterior recria os lembretes daquele horário', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_11H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_10H })
    const pendentes = await fila(s.b.id, {
      kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] },
      status: 'PENDING',
    })
    expect(pendentes).toHaveLength(2)
    expect(pendentes.every((r) => r.scheduledFor.getTime() === addMinutes(QUINTA_10H, r.kind.endsWith('24H') ? -1440 : -60).getTime())).toBe(true)
  })

  test('concluir cancela os lembretes e agradece ao cliente', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: SEGUNDA_10H })
    const depois = await makeCtx(s.b, { now: addMinutes(SEGUNDA_10H, 40) })
    await completeAppointment(depois, v.id)
    const rows = await fila(s.b.id)
    expect(resumo(rows.filter((r) => r.kind === 'APPOINTMENT_COMPLETED'))).toEqual(ambos('APPOINTMENT_COMPLETED'))
    expect(rows.find((r) => r.kind === 'APPOINTMENT_COMPLETED')?.dedupeKey).toBe(`APPOINTMENT_COMPLETED:EMAIL:${v.id}`)
    expect(rows.filter((r) => r.kind.startsWith('APPOINTMENT_REMINDER')).every((r) => r.status === 'CANCELED')).toBe(true)
  })

  test('falta cancela os lembretes sem avisar; desfazer não grava nada', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: SEGUNDA_10H })
    const depois = await makeCtx(s.b, { now: addMinutes(SEGUNDA_10H, 40) })
    await markNoShow(depois, v.id)
    const aposFalta = await fila(s.b.id)
    expect(aposFalta.filter((r) => r.kind.startsWith('APPOINTMENT_REMINDER')).every((r) => r.status === 'CANCELED')).toBe(true)
    expect(aposFalta).toHaveLength(3)
    await undoOutcome(depois, v.id)
    expect(await fila(s.b.id)).toHaveLength(3)
  })

  test('ajustar não grava nada', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const antes = await prisma.notification.count({ where: { businessId: s.b.id } })
    await adjustAppointment(s.gerente, v.id, { totalCents: 4000, notes: 'desconto' })
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(antes)
  })

  test('conta sem autoConfirm: o pedido avisa "recebido", sem lembrete; confirmar envia a confirmação e os lembretes', async () => {
    const s = await montar({ autoConfirm: false })
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    expect(v.status).toBe('PENDING')
    expect(resumo(await fila(s.b.id))).toEqual([...ambos('APPOINTMENT_REQUESTED'), ...ambos('STAFF_NEW_APPOINTMENT')].sort())
    expect((await fila(s.b.id, { kind: 'APPOINTMENT_REQUESTED' })).every((r) => r.customerId === s.cliente.id)).toBe(true)
    await confirmAppointment(s.gerente, v.id)
    const rows = await fila(s.b.id)
    expect(resumo(rows)).toEqual(
      [
        ...ambos('APPOINTMENT_REQUESTED'),
        ...ambos('STAFF_NEW_APPOINTMENT'),
        ...ambos('APPOINTMENT_CONFIRMED'),
        ...ambos('APPOINTMENT_REMINDER_24H'),
        ...ambos('APPOINTMENT_REMINDER_1H'),
      ].sort(),
    )
    await confirmAppointment(s.gerente, v.id).catch(() => undefined)
    expect(await prisma.notification.count({ where: { businessId: s.b.id } })).toBe(5)
  })

  test('remarcar um pendente continua sem lembretes', async () => {
    const s = await montar({ autoConfirm: false })
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_11H })
    expect(await fila(s.b.id, { kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } })).toHaveLength(0)
  })

  test('A -> B -> A -> B: quatro avisos de remarcação por canal, o último com o horário B', async () => {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_11H })
    for (const alvo of [QUINTA_10H, QUINTA_11H, QUINTA_10H, QUINTA_11H]) {
      await rescheduleAppointment(s.gerente, v.id, { startsAt: alvo })
    }
    const emails = await fila(s.b.id, { kind: 'APPOINTMENT_RESCHEDULED', channel: 'EMAIL' })
    expect(emails).toHaveLength(4)
    const ultimo = [...emails].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).at(-1)
    expect(ultimo?.payload).toMatchObject({ startsAt: QUINTA_11H.toISOString(), previousStartsAt: QUINTA_10H.toISOString() })
  })

  test('cliente remarca trocando de profissional: o membro antigo recebe o cancelamento do horário antigo', async () => {
    const s = await montar()
    const userCaio = await makeUser()
    const vinculoCaio = await makeMembership(s.b.id, userCaio.id, 'PROFESSIONAL')
    const caio = await makeProfessional(s.b.id, { name: 'Caio', serviceIds: [s.tosa.id], membershipId: vinculoCaio.id })
    await makeWorkingHours(s.b.id, caio.id, 'THURSDAY', [MANHA])
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.clienteCtx, v.id, { startsAt: QUINTA_11H, professionalId: caio.id })
    const antigo = await fila(s.b.id, { kind: 'STAFF_APPOINTMENT_CANCELED' })
    expect(resumo(antigo)).toEqual(ambos('STAFF_APPOINTMENT_CANCELED'))
    expect(antigo.every((r) => r.membershipId === s.vinculo.id)).toBe(true)
    expect(antigo[0]?.payload).toEqual({ appointmentId: v.id, startsAt: QUINTA_10H.toISOString(), reason: 'moved' })
    // o profissional novo recebe "novo agendamento" (não "remarcado"), com o horário novo
    const novo = (await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })).filter((r) => r.membershipId === vinculoCaio.id)
    expect(resumo(novo)).toEqual(ambos('STAFF_NEW_APPOINTMENT'))
    expect(novo[0]?.payload).toMatchObject({ appointmentId: v.id, startsAt: QUINTA_11H.toISOString() })
    expect(await fila(s.b.id, { kind: 'STAFF_APPOINTMENT_RESCHEDULED' })).toHaveLength(0)
  })
})

describe('avisos de toda a loja (observadores)', () => {
  async function observador(businessId: string, role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', o: { ligado?: boolean; active?: boolean } = {}) {
    const user = await makeUser()
    const vinculo = await makeMembership(businessId, user.id, role)
    await prisma.membership.update({
      where: { id: vinculo.id },
      data: { notifyAllAppointments: o.ligado ?? true, ...(o.active === false ? { active: false } : {}) },
    })
    return vinculo
  }
  const deles = <T extends { membershipId: string | null }>(rows: T[], id: string): T[] => rows.filter((r) => r.membershipId === id)

  test('agendamento do cliente: o profissional e o gerente observador recebem por e-mail, o observador marcado e com chave própria', async () => {
    const s = await montar()
    const gerente = await observador(s.b.id, 'MANAGER')
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const novos = await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })
    expect(resumo(deles(novos, s.vinculo.id))).toEqual(ambos('STAFF_NEW_APPOINTMENT'))
    const dele = deles(novos, gerente.id)
    expect(resumo(dele)).toEqual(['STAFF_NEW_APPOINTMENT/EMAIL/PENDING'])
    expect(dele[0]?.dedupeKey).toBe(`STAFF_NEW_APPOINTMENT:EMAIL:${v.id}:w:${gerente.id}`)
    expect(dele[0]?.payload).toEqual({ appointmentId: v.id, startsAt: QUINTA_10H.toISOString(), audience: 'watcher' })
    // O aviso do profissional não ganha marca nenhuma.
    expect(deles(novos, s.vinculo.id).every((r) => r.payload && !('audience' in (r.payload as object)))).toBe(true)
  })

  test('preferência desligada (padrão), profissional com a coluna ligada e vínculo desativado: ninguém além do profissional recebe', async () => {
    const s = await montar()
    const desligado = await observador(s.b.id, 'OWNER', { ligado: false })
    const profissional = await observador(s.b.id, 'PROFESSIONAL')
    const inativo = await observador(s.b.id, 'MANAGER', { active: false })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const novos = await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })
    expect(resumo(novos)).toEqual(ambos('STAFF_NEW_APPOINTMENT'))
    for (const v of [desligado, profissional, inativo]) expect(deles(novos, v.id)).toHaveLength(0)
  })

  test('dono que é o próprio profissional do atendimento recebe um aviso só (sem cópia de observador)', async () => {
    const s = await montar({ comVinculo: false })
    const dono = await observador(s.b.id, 'OWNER')
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: dono.id } })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const novos = await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })
    expect(resumo(novos)).toEqual(ambos('STAFF_NEW_APPOINTMENT'))
    expect(novos.every((r) => r.membershipId === dono.id && !r.dedupeKey.includes(':w:'))).toBe(true)
  })

  test('tipo desligado na conta: o observador também não recebe', async () => {
    const s = await montar()
    await observador(s.b.id, 'OWNER')
    await updateNotificationSettings(s.gerente, { STAFF_NEW_APPOINTMENT: { email: false } })
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    expect(await fila(s.b.id, { kind: 'STAFF_NEW_APPOINTMENT' })).toHaveLength(0)
  })

  test('cancelamento e remarcação pelo cliente também avisam o observador, por e-mail', async () => {
    const s = await montar()
    const dono = await observador(s.b.id, 'OWNER')
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.clienteCtx, v.id, { startsAt: QUINTA_11H })
    await cancelAppointment(s.clienteCtx, v.id)
    const rows = await fila(s.b.id)
    const dele = deles(rows, dono.id)
    expect(resumo(dele.filter((r) => r.kind !== 'STAFF_NEW_APPOINTMENT'))).toEqual([
      'STAFF_APPOINTMENT_CANCELED/EMAIL/PENDING',
      'STAFF_APPOINTMENT_RESCHEDULED/EMAIL/PENDING',
    ])
    expect(dele.every((r) => r.channel === 'EMAIL' && (r.payload as { audience?: string }).audience === 'watcher')).toBe(true)
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: v.id } })
    expect(dele.find((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED')?.dedupeKey).toBe(`STAFF_APPOINTMENT_CANCELED:EMAIL:${v.id}:w:${dono.id}`)
    expect(dele.find((r) => r.kind === 'STAFF_APPOINTMENT_RESCHEDULED')?.dedupeKey).toMatch(new RegExp(`^STAFF_APPOINTMENT_RESCHEDULED:EMAIL:${v.id}:\\d+:w:${dono.id}$`))
    expect(depois.status).toBe('CANCELED')
  })

  test('observador (dono com avisos de toda a loja) recebe aviso por e-mail, um por evento', async () => {
    const s = await montar()
    const dono = await observador(s.b.id, 'OWNER')
    await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    const dele = deles(await fila(s.b.id), dono.id)
    expect(dele).toHaveLength(1)
    expect(dele[0]).toMatchObject({ kind: 'STAFF_NEW_APPOINTMENT', channel: 'EMAIL', payload: expect.objectContaining({ audience: 'watcher' }) })
    expect(dele[0]?.dedupeKey).toMatch(new RegExp(`:w:${dono.id}$`))
  })

  test('nenhuma linha de push é criada', async () => {
    const s = await montar()
    await observador(s.b.id, 'OWNER')
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.clienteCtx, v.id, { startsAt: QUINTA_11H })
    await cancelAppointment(s.clienteCtx, v.id)
    const canais = await prisma.$queryRaw<{ channel: string }[]>`SELECT DISTINCT channel::text AS channel FROM notifications`
    expect(canais).toEqual([{ channel: 'EMAIL' }])
  })

  test('ações da equipe não avisam observador', async () => {
    const s = await montar()
    const dono = await observador(s.b.id, 'OWNER')
    const v = await bookAppointment(s.gerente, { professionalId: s.ana.id, serviceIds: [s.tosa.id], customerId: s.cliente.id, startsAt: QUINTA_10H })
    await rescheduleAppointment(s.gerente, v.id, { startsAt: QUINTA_11H })
    await cancelAppointment(s.gerente, v.id)
    expect(deles(await fila(s.b.id), dono.id)).toHaveLength(0)
  })

  test('remarcação com troca de profissional: o observador recebe um único aviso (sem o par "moved"), e os dois profissionais seguem como antes', async () => {
    const s = await montar()
    const dono = await observador(s.b.id, 'OWNER')
    const userCaio = await makeUser()
    const vinculoCaio = await makeMembership(s.b.id, userCaio.id, 'PROFESSIONAL')
    const caio = await makeProfessional(s.b.id, { name: 'Caio', serviceIds: [s.tosa.id], membershipId: vinculoCaio.id })
    await makeWorkingHours(s.b.id, caio.id, 'THURSDAY', [MANHA])
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await rescheduleAppointment(s.clienteCtx, v.id, { startsAt: QUINTA_11H, professionalId: caio.id })
    const rows = await fila(s.b.id)
    const dele = deles(rows, dono.id).filter((r) => r.payload && JSON.stringify(r.payload).includes('watcher'))
    expect(resumo(dele.filter((r) => r.kind !== 'STAFF_NEW_APPOINTMENT'))).toEqual(['STAFF_APPOINTMENT_RESCHEDULED/EMAIL/PENDING'])
    expect(dele.filter((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED')).toHaveLength(0)
    expect(resumo(deles(rows, s.vinculo.id).filter((r) => r.kind === 'STAFF_APPOINTMENT_CANCELED'))).toEqual(ambos('STAFF_APPOINTMENT_CANCELED'))
    expect(resumo(deles(rows, vinculoCaio.id).filter((r) => r.kind === 'STAFF_NEW_APPOINTMENT'))).toEqual(ambos('STAFF_NEW_APPOINTMENT'))
  })
})

describe('cancelPendingForCustomer e cadastro', () => {
  async function comAvisos() {
    const s = await montar()
    const v = await bookAppointment(s.clienteCtx, { professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: QUINTA_10H })
    await prisma.notification.updateMany({ where: { kind: 'APPOINTMENT_CONFIRMED', channel: 'EMAIL' }, data: { status: 'SENT' } })
    return { ...s, v }
  }

  test('cancela só os pendentes do cliente, na conta certa', async () => {
    const s = await comAvisos()
    const outro = await makeCustomer(s.b.id)
    const outroAppt = await makeAppointment(s.b.id, { customerId: outro.id, professionalId: s.ana.id, serviceId: s.tosa.id, startsAt: QUINTA_11H })
    await s.gerente.db.$transaction((tx) => enqueueAppointmentEvent(tx, s.gerente, 'booked', outroAppt))
    await s.gerente.db.$transaction((tx) => cancelPendingForCustomer(tx, s.cliente.id))
    const doCliente = await fila(s.b.id, { customerId: s.cliente.id })
    expect(doCliente.filter((r) => r.status === 'PENDING')).toHaveLength(0)
    expect(doCliente.filter((r) => r.status === 'SENT')).toHaveLength(1)
    expect(doCliente.filter((r) => r.status === 'CANCELED')).toHaveLength(2)
    expect((await fila(s.b.id, { customerId: outro.id })).every((r) => r.status === 'PENDING')).toBe(true)
    expect((await fila(s.b.id, { membershipId: s.vinculo.id })).every((r) => r.status === 'PENDING')).toBe(true)
  })

  test('arquivar cancela os avisos pendentes do cliente', async () => {
    const s = await comAvisos()
    // Arquivar exige que não haja agendamento futuro; os avisos pendentes ficam na fila.
    await prisma.appointment.update({ where: { id: s.v.id }, data: { status: 'CANCELED' } })
    await archiveCustomer(s.gerente, s.cliente.id)
    expect(await fila(s.b.id, { customerId: s.cliente.id, status: 'PENDING' })).toHaveLength(0)
    expect(await fila(s.b.id, { customerId: s.cliente.id, status: 'CANCELED' })).toHaveLength(2)
  })

  test('anonimizar cancela os avisos pendentes do cliente', async () => {
    const s = await comAvisos()
    await anonymizeCustomer(s.gerente, s.cliente.id)
    expect(await fila(s.b.id, { customerId: s.cliente.id, status: 'PENDING' })).toHaveLength(0)
    expect(await fila(s.b.id, { customerId: s.cliente.id, status: 'CANCELED' })).toHaveLength(2)
  })
})

describe('notifyProfessionalFreeEarly', () => {
  async function hoje(extra: { status?: 'CONFIRMED' | 'PENDING'; startsAt?: Date } = {}) {
    const s = await montar()
    const appt = await makeAppointment(s.b.id, {
      customerId: s.cliente.id,
      professionalId: s.ana.id,
      serviceId: s.tosa.id,
      startsAt: extra.startsAt ?? SEGUNDA_10H,
      ...(extra.status ? { status: extra.status } : {}),
    })
    return { ...s, appt }
  }

  test('avisa o cliente uma única vez e audita', async () => {
    const s = await hoje()
    await notifyProfessionalFreeEarly(s.gerente, s.appt.id)
    await notifyProfessionalFreeEarly(s.gerente, s.appt.id)
    const rows = await fila(s.b.id, { kind: 'PROFESSIONAL_FREE_EARLY' })
    expect(resumo(rows)).toEqual(ambos('PROFESSIONAL_FREE_EARLY'))
    expect(rows[0]?.customerId).toBe(s.cliente.id)
    expect(rows[0]?.scheduledFor.toISOString()).toBe(SEGUNDA_08H.toISOString())
    expect(rows[0]?.dedupeKey).toBe(`PROFESSIONAL_FREE_EARLY:${rows[0]?.channel}:${s.appt.id}`)
    const audits = await prisma.auditLog.findMany({ where: { businessId: s.b.id, action: 'appointment.free_early_notified' } })
    expect(audits).toHaveLength(2)
    expect(audits.every((a) => a.targetId === s.appt.id)).toBe(true)
    expect(audits.map((a) => (a.metadata as { queued: number }).queued).sort()).toEqual([0, 1])
  })

  test('o próprio profissional pode; outro profissional não', async () => {
    const s = await hoje()
    const user = await prisma.membership.findUniqueOrThrow({ where: { id: s.vinculo.id } })
    const proprio = await makeCtx(s.b, {
      actor: { kind: 'member', userId: user.userId, membershipId: s.vinculo.id, name: 'Ana', role: 'PROFESSIONAL' },
      now: SEGUNDA_08H,
    })
    await notifyProfessionalFreeEarly(proprio, s.appt.id)
    expect(await fila(s.b.id, { kind: 'PROFESSIONAL_FREE_EARLY' })).toHaveLength(1)
    const outro = await ctxWithRole(s.b, 'PROFESSIONAL', { now: SEGUNDA_08H })
    expect((await domainError(notifyProfessionalFreeEarly(outro, s.appt.id))).code).toBe('forbidden')
  })

  test('cliente do app não pode', async () => {
    const s = await hoje()
    expect((await domainError(notifyProfessionalFreeEarly(s.clienteCtx, s.appt.id))).code).toBe('forbidden')
  })

  test('recusa agendamento pendente, de outro dia ou já iniciado', async () => {
    const pendente = await hoje({ status: 'PENDING' })
    const e1 = await domainError(notifyProfessionalFreeEarly(pendente.gerente, pendente.appt.id))
    expect([e1.code, e1.reason]).toEqual(['conflict', 'invalid_status'])
    const amanha = await hoje({ startsAt: new Date('2026-11-17T13:00:00Z') })
    const e2 = await domainError(notifyProfessionalFreeEarly(amanha.gerente, amanha.appt.id))
    expect([e2.code, e2.reason]).toEqual(['conflict', 'not_today'])
    const iniciado = await hoje({ startsAt: new Date('2026-11-16T10:00:00Z') })
    const e3 = await domainError(notifyProfessionalFreeEarly(iniciado.gerente, iniciado.appt.id))
    expect([e3.code, e3.reason]).toEqual(['conflict', 'already_started'])
    expect(await prisma.notification.count()).toBe(0)
  })

  test('agendamento inexistente é not_found', async () => {
    const s = await hoje()
    expect((await domainError(notifyProfessionalFreeEarly(s.gerente, 'x'))).code).toBe('not_found')
    expect((await domainError(notifyProfessionalFreeEarly(s.gerente, '00000000-0000-4000-8000-000000000000'))).code).toBe('not_found')
  })
})

describe('configurações de avisos', () => {
  test('gerente altera, lê de volta e audita os tipos alterados; profissional não altera', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER')
    const novo = await updateNotificationSettings(gerente, {
      APPOINTMENT_REMINDER_1H: { email: false },
      APPOINTMENT_CANCELED: { email: false },
    })
    expect(novo.APPOINTMENT_REMINDER_1H).toEqual({ email: false })
    expect(novo.APPOINTMENT_CANCELED).toEqual({ email: false })
    expect(await getNotificationSettings(gerente)).toEqual(novo)
    const salvo = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId: b.id } })
    expect(salvo.notifications).toEqual(novo)
    const linhas = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'notification_settings.updated' } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.metadata).toEqual({
      kinds: ['APPOINTMENT_CANCELED', 'APPOINTMENT_REMINDER_1H'] satisfies NotificationKind[],
      changes: {
        APPOINTMENT_CANCELED: { from: { email: true }, to: { email: false } },
        APPOINTMENT_REMINDER_1H: { from: { email: true }, to: { email: false } },
      },
    })
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(updateNotificationSettings(prof, { APPOINTMENT_CANCELED: { email: true } }))).code).toBe('forbidden')
    expect(await getNotificationSettings(prof)).toEqual(novo)
  })

  test('tipo desconhecido ou valor inválido é recusado; sem mudança não audita', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER')
    const invalido = JSON.parse('{"FOO":{"email":false}}')
    expect((await domainError(updateNotificationSettings(gerente, invalido))).code).toBe('validation')
    const ruim = JSON.parse('{"APPOINTMENT_CONFIRMED":{"email":"não"}}')
    expect((await domainError(updateNotificationSettings(gerente, ruim))).code).toBe('validation')
    const push = JSON.parse('{"APPOINTMENT_CONFIRMED":{"push":false}}')
    expect((await domainError(updateNotificationSettings(gerente, push))).code).toBe('validation')
    await updateNotificationSettings(gerente, { APPOINTMENT_CONFIRMED: { email: true } })
    await updateNotificationSettings(gerente, {})
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'notification_settings.updated' } })).toBe(0)
  })

  test('duas alterações simultâneas de tipos diferentes não se perdem', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER')
    await Promise.all([
      updateNotificationSettings(gerente, { APPOINTMENT_CANCELED: { email: false } }),
      updateNotificationSettings(gerente, { APPOINTMENT_COMPLETED: { email: false } }),
      updateNotificationSettings(gerente, { PROFESSIONAL_FREE_EARLY: { email: false } }),
    ])
    const s = await getNotificationSettings(gerente)
    expect(s.APPOINTMENT_CANCELED.email).toBe(false)
    expect(s.APPOINTMENT_COMPLETED.email).toBe(false)
    expect(s.PROFESSIONAL_FREE_EARLY.email).toBe(false)
  })

  test('JSON estragado no banco não derruba a leitura', async () => {
    const b = await makeBusiness()
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { notifications: 'lixo' } })
    const s = await getNotificationSettings(await makeCtx(b))
    expect(s.APPOINTMENT_CONFIRMED).toEqual({ email: true })
  })
})
