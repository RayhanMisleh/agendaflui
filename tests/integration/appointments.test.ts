import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  getAppointment,
  markNoShow,
  rescheduleAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeProfessional,
  makeService,
  makeWorkingHours,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

const MANHA = { startMin: 540, endMin: 720 }
const TARDE = { startMin: 780, endMin: 1080 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
/** Segunda-feira, 10:00 em São Paulo. */
const DEZ = new Date('2026-11-16T13:00:00Z')
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 16, h + 3, m))

async function montar(o: { now?: Date } = {}) {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000, rewardPoints: 10 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, commissionBps: 4500, serviceIds: [banho.id, tosa.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id, tosa.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'MONDAY', [MANHA, TARDE])
  const now = o.now ?? SEGUNDA_08H
  const gerente = await makeCtx(b, { now })
  const cliente = await customerCtx(b, now)
  return { b, banho, tosa, ana, caio, gerente, cliente, now }
}

async function customerCtx(b: { id: string }, now: Date, customerId?: string, o: { phone?: string } = {}) {
  const customer = customerId
    ? await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })
    : await makeCustomer(b.id, o)
  return makeCtx(b, { actor: { kind: 'customer', customerId: customer.id, name: customer.name }, now })
}

const idDe = (ctx: { actor: { kind: string } }): string => {
  const a = ctx.actor as { kind: 'customer'; customerId: string }
  return a.customerId
}

const total = (businessId: string) => prisma.appointment.count({ where: { businessId } })
const audits = (businessId: string, action: string) => prisma.auditLog.findMany({ where: { businessId, action } })

describe('bookAppointment pelo cliente', () => {
  test('marca 10:00 com banho: confirmado, origem APP, horários locais e item copiado', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(v.status).toBe('CONFIRMED')
    expect(v.source).toBe('APP')
    expect(v.local).toEqual({ date: '2026-11-16', start: '10:00', end: '11:00' })
    expect(v.startsAt.toISOString()).toBe('2026-11-16T13:00:00.000Z')
    expect(v.endsAt.toISOString()).toBe('2026-11-16T14:00:00.000Z')
    expect(v.items).toEqual([{ serviceId: s.banho.id, name: 'Banho', priceCents: 8000, durationMin: 60, variant: null }])
    expect(v.totalCents).toBe(8000)
    expect(v.totalDurationMin).toBe(60)
    expect(v.professional).toEqual({ id: s.ana.id, name: 'Ana' })
    expect(v.customer.id).toBe(idDe(s.cliente))
    expect(v).not.toHaveProperty('commissionCents')
    expect(v).not.toHaveProperty('notes')
    expect(v.canceledAt).toBeNull()
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: v.id }, include: { items: true } })
    expect(row.createdByType).toBe('CUSTOMER')
    expect(row.createdById).toBe(idDe(s.cliente))
    expect(row.items.map((i) => [i.position, i.rewardPoints])).toEqual([[1, 10]])
  })

  test('o cliente não vê comissão nem observações da equipe, mas a equipe vê', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id, { phone: '5511912345678' })
    const feito = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ, notes: '  cão bravo  ',
    })
    expect(feito.notes).toBe('cão bravo')
    expect(feito.customer.phoneLabel).toBe('(11) 91234-5678')
    const dono = await customerCtx(s.b, s.now, cli.id)
    const visto = await getAppointment(dono, feito.id)
    expect(visto).not.toHaveProperty('notes')
    expect(visto).not.toHaveProperty('commissionCents')
    expect((await getAppointment(s.gerente, feito.id)).notes).toBe('cão bravo')
  })

  test('a auditoria de uma ação do cliente grava "Cliente" como autor, sem o nome real, e o customerId em metadata', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const [log] = await audits(s.b.id, 'appointment.booked')
    expect(log?.actorName).toBe('Cliente')
    expect(log?.actorType).toBe('SYSTEM')
    expect(log?.targetId).toBe(v.id)
    expect(log?.metadata).toMatchObject({ customerId: idDe(s.cliente) })
  })

  test('alterar o preço do serviço depois não muda o agendamento', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    await prisma.service.update({ where: { id: s.banho.id }, data: { priceCents: 9999, name: 'Banho premium', durationMin: 90 } })
    const depois = await getAppointment(s.gerente, v.id)
    expect(depois.totalCents).toBe(8000)
    expect(depois.items).toEqual([{ serviceId: s.banho.id, name: 'Banho', priceCents: 8000, durationMin: 60, variant: null }])
    expect(depois.endsAt.toISOString()).toBe('2026-11-16T14:00:00.000Z')
  })

  test('sem autoConfirm nasce PENDING', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { autoConfirm: false } })
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(v.status).toBe('PENDING')
  })

  test('fora da grade (10:10) e antes da antecedência (08:30) dão slot_unavailable', async () => {
    const s = await montar()
    for (const startsAt of [new Date('2026-11-16T13:10:00Z'), new Date('2026-11-16T11:30:00Z')]) {
      const e = await domainError(bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt }))
      expect(e.code).toBe('conflict')
      expect(e.reason).toBe('slot_unavailable')
    }
    expect(await total(s.b.id)).toBe(0)
  })

  test('segundos e milissegundos no início nunca passam', async () => {
    const s = await montar()
    const e = await domainError(
      bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date(DEZ.getTime() + 1) }),
    )
    expect(e.code).toBe('conflict')
    const g = await domainError(
      bookAppointment(s.gerente, { customerId: idDe(s.cliente), professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date(DEZ.getTime() + 1000) }),
    )
    expect(g.code).toBe('validation')
    expect(g.fields).toHaveProperty('startsAt')
    expect(await total(s.b.id)).toBe(0)
  })

  test('cliente marca só para si; outro cliente dá forbidden', async () => {
    const s = await montar()
    const outro = await makeCustomer(s.b.id)
    const e = await domainError(
      bookAppointment(s.cliente, { customerId: outro.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }),
    )
    expect(e.code).toBe('forbidden')
    const v = await bookAppointment(s.cliente, { customerId: idDe(s.cliente), professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(v.customer.id).toBe(idDe(s.cliente))
  })

  test('cliente arquivado ou anonimizado recebe forbidden', async () => {
    const s = await montar()
    await prisma.customer.update({ where: { id: idDe(s.cliente) }, data: { archivedAt: new Date('2026-11-01T00:00:00Z') } })
    const e = await domainError(bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }))
    expect(e.code).toBe('forbidden')
    const anon = await customerCtx(s.b, s.now)
    await prisma.customer.update({ where: { id: idDe(anon) }, data: { anonymizedAt: new Date('2026-11-01T00:00:00Z') } })
    const e2 = await domainError(bookAppointment(anon, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }))
    expect(e2.code).toBe('forbidden')
    expect(await total(s.b.id)).toBe(0)
  })

  test('dois clientes no mesmo horário e profissional: o segundo recebe slot_taken', async () => {
    const s = await montar()
    await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const outro = await customerCtx(s.b, s.now)
    const e = await domainError(bookAppointment(outro, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('slot_taken')
    expect(await total(s.b.id)).toBe(1)
  })
})

describe('bookAppointment pela equipe', () => {
  test('gerente marca fora da grade (10:10) e fora do expediente (07:00)', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const a = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date('2026-11-16T13:10:00Z'),
    })
    expect(a.status).toBe('CONFIRMED')
    expect(a.source).toBe('PANEL')
    expect(a.local.start).toBe('10:10')
    const b = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(7),
    })
    expect(b.local).toEqual({ date: '2026-11-16', start: '07:00', end: '07:30' })
  })

  test('23:30 por 60 min atravessa a meia-noite: 00:15 do dia seguinte dá slot_taken e 00:30 é aceito', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const noite = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(23, 30),
    })
    expect(noite.local).toEqual({ date: '2026-11-16', start: '23:30', end: '00:30' })
    const cedo = await domainError(
      bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(24, 15) }),
    )
    expect(cedo.reason).toBe('slot_taken')
    const depois = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(24, 30),
    })
    expect(depois.local).toEqual({ date: '2026-11-17', start: '00:30', end: '01:00' })
    expect(await total(s.b.id)).toBe(2)
  })

  test('mesmo sem autoConfirm a equipe marca CONFIRMED; folga não vale para a equipe', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { autoConfirm: false, bufferMin: 30 } })
    const cli = await makeCustomer(s.b.id)
    await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const colado = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(11),
    })
    expect(colado.status).toBe('CONFIRMED')
  })

  test('em dia fechado e com data passada recente a equipe marca', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z') },
    })
    const fechado = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(fechado.status).toBe('CONFIRMED')
    const passado = await bookAppointment(s.gerente, {
      customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date('2026-11-10T13:00:00Z'),
    })
    expect(passado.local.date).toBe('2026-11-10')
  })

  test('mais de 366 dias para trás ou para a frente dá validation em startsAt', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    for (const startsAt of [new Date('2025-11-01T13:00:00Z'), new Date('2027-12-01T13:00:00Z')]) {
      const e = await domainError(
        bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt }),
      )
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('startsAt')
    }
  })

  test('sem cliente, cliente de outra conta, arquivado ou anonimizado: validation em customerId', async () => {
    const s = await montar()
    const outra = await makeBusiness()
    const alheio = await makeCustomer(outra.id)
    const arquivado = await makeCustomer(s.b.id, { archivedAt: new Date('2026-11-01T00:00:00Z') })
    const anonimo = await makeCustomer(s.b.id, { anonymizedAt: new Date('2026-11-01T00:00:00Z') })
    const casos: (string | undefined)[] = [undefined, alheio.id, arquivado.id, anonimo.id, crypto.randomUUID(), 'x']
    for (const customerId of casos) {
      const e = await domainError(
        bookAppointment(s.gerente, {
          ...(customerId === undefined ? {} : { customerId }),
          professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ,
        }),
      )
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('customerId')
    }
    expect(await total(s.b.id)).toBe(0)
  })

  test('sobre outro agendamento ativo: slot_taken com os próximos inícios livres', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    const e = await domainError(
      bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: new Date('2026-11-16T13:30:00Z') }),
    )
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('slot_taken')
    expect(e.message).toBe('Esse horário acabou de ser ocupado. Escolha outro.')
    const nearest = e.details?.['nearest'] as { startsAt: Date; label: string; date: string }[]
    expect(nearest).toHaveLength(3)
    expect(nearest.map((n) => n.date)).toEqual(['2026-11-16', '2026-11-16', '2026-11-16'])
    expect(nearest.map((n) => n.label)).toEqual(['11:00', '13:00', '13:30'])
    expect(nearest[0]?.startsAt).toEqual(hora(11))
    expect(await total(s.b.id)).toBe(1)
  })

  test('sobre bloqueio do profissional: blocked', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: hora(10), endsAt: hora(12), createdByType: 'SYSTEM' },
    })
    const e = await domainError(
      bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(11) }),
    )
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('blocked')
    expect(await total(s.b.id)).toBe(0)
  })

  test('serviços e profissional inválidos dão validation e nada é gravado', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const outra = await makeBusiness()
    const alheio = await makeService(outra.id)
    const inativo = await makeService(s.b.id, { active: false })
    const arquivado = await makeService(s.b.id, { archivedAt: new Date('2026-11-01T00:00:00Z') })
    const soTosa = await makeProfessional(s.b.id, { name: 'Bia', serviceIds: [s.tosa.id] })
    const lista: string[][] = [[], [s.banho.id, s.banho.id], [arquivado.id], [inativo.id], [alheio.id]]
    for (const serviceIds of lista) {
      const e = await domainError(bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds, startsAt: DEZ }))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('serviceIds')
    }
    const p = await domainError(
      bookAppointment(s.gerente, { customerId: cli.id, professionalId: soTosa.id, serviceIds: [s.banho.id], startsAt: DEZ }),
    )
    expect(p.code).toBe('validation')
    expect(p.fields).toHaveProperty('professionalId')
    expect(await total(s.b.id)).toBe(0)
    expect(await prisma.appointmentItem.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('qualquer profissional escolhe o de menos agendamentos no dia; no empate, o de menor displayOrder', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const empate = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: null, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(empate.professional.id).toBe(s.ana.id)
    // Ana agora tem 1 no dia: o próximo, em outro horário, vai para Caio.
    const seguinte = await bookAppointment(s.gerente, { customerId: cli.id, serviceIds: [s.banho.id], startsAt: hora(14) })
    expect(seguinte.professional.id).toBe(s.caio.id)
    // Mesmo horário da primeira: Ana está ocupada, só Caio está livre.
    const livre = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: null, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(livre.professional.id).toBe(s.caio.id)
    const cheio = await domainError(bookAppointment(s.gerente, { customerId: cli.id, serviceIds: [s.banho.id], startsAt: DEZ }))
    expect(cheio.reason).toBe('slot_taken')
  })

  test('cliente do app em qualquer profissional: escolhe entre os livres', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    const v = await bookAppointment(s.cliente, { serviceIds: [s.banho.id], startsAt: DEZ })
    expect(v.professional.id).toBe(s.caio.id)
  })

  test('profissional PROFESSIONAL marca só na própria agenda', async () => {
    const s = await montar()
    const pro = await ctxWithRole(s.b, 'PROFESSIONAL', { now: s.now })
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: memberOf(pro).membershipId } })
    const cli = await makeCustomer(s.b.id)
    const outro = await domainError(
      bookAppointment(pro, { customerId: cli.id, professionalId: s.caio.id, serviceIds: [s.banho.id], startsAt: DEZ }),
    )
    expect(outro.code).toBe('forbidden')
    const meu = await bookAppointment(pro, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(meu.professional.id).toBe(s.ana.id)
    const semProfissional = await bookAppointment(pro, { customerId: cli.id, serviceIds: [s.banho.id], startsAt: hora(14) })
    expect(semProfissional.professional.id).toBe(s.ana.id)
  })
})

describe('leitura e acesso', () => {
  test('cliente A não lê nem cancela o agendamento do cliente B', async () => {
    const s = await montar()
    const b = await customerCtx(s.b, s.now)
    const v = await bookAppointment(b, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    for (const e of [await domainError(getAppointment(s.cliente, v.id)), await domainError(cancelAppointment(s.cliente, v.id))]) {
      expect(e.code).toBe('not_found')
    }
    expect((await getAppointment(s.gerente, v.id)).status).toBe('CONFIRMED')
  })

  test('agendamento de outra conta e id malformado dão not_found', async () => {
    const s = await montar()
    const outra = await makeBusiness()
    const svc = await makeService(outra.id)
    const prof = await makeProfessional(outra.id, { serviceIds: [svc.id] })
    const cli = await makeCustomer(outra.id)
    const alheio = await makeAppointment(outra.id, { customerId: cli.id, professionalId: prof.id, serviceId: svc.id, startsAt: DEZ })
    for (const id of [alheio.id, 'x', crypto.randomUUID()]) {
      expect((await domainError(getAppointment(s.gerente, id))).code).toBe('not_found')
      expect((await domainError(cancelAppointment(s.gerente, id))).code).toBe('not_found')
      expect((await domainError(confirmAppointment(s.gerente, id))).code).toBe('not_found')
    }
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: alheio.id } })).status).toBe('CONFIRMED')
  })

  test('papel PROFESSIONAL age no próprio agendamento e recebe forbidden no de um colega', async () => {
    const s = await montar()
    const pro = await ctxWithRole(s.b, 'PROFESSIONAL', { now: s.now })
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: memberOf(pro).membershipId } })
    const cli = await makeCustomer(s.b.id)
    const meu = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    const dele = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.caio.id, serviceId: s.banho.id, startsAt: DEZ })
    expect((await getAppointment(pro, meu.id)).id).toBe(meu.id)
    expect((await cancelAppointment(pro, meu.id)).status).toBe('CANCELED')
    for (const op of [getAppointment, cancelAppointment, confirmAppointment]) {
      expect((await domainError(op(pro, dele.id))).code).toBe('forbidden')
    }
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: dele.id } })).status).toBe('CONFIRMED')
  })

  test('cliente do app não confirma, conclui, marca falta, desfaz nem ajusta', async () => {
    const s = await montar({ now: new Date('2026-11-16T20:00:00Z') })
    const cli = await makeCustomer(s.b.id)
    const ag = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    const dono = await customerCtx(s.b, s.now, cli.id)
    for (const op of [confirmAppointment, completeAppointment, markNoShow, undoOutcome]) {
      expect((await domainError(op(dono, ag.id))).code).toBe('forbidden')
    }
    expect((await domainError(adjustAppointment(dono, ag.id, { totalCents: 1 }))).code).toBe('forbidden')
  })
})

describe('cancelar', () => {
  test('cliente cancela com 3 h de antecedência e é barrado com 1 h (janela de 120 min)', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const tarde = hora(13)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: tarde })
    const b = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.caio.id, serviceId: s.banho.id, startsAt: tarde })
    const tresHoras = await customerCtx(s.b, hora(10), cli.id)
    const umaHora = await customerCtx(s.b, hora(12), cli.id)
    const barrado = await domainError(cancelAppointment(umaHora, b.id, { reason: 'imprevisto' }))
    expect(barrado.code).toBe('conflict')
    expect(barrado.reason).toBe('too_late')
    expect(barrado.message).toContain('2 h')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED')
    const v = await cancelAppointment(tresHoras, a.id, { reason: '  imprevisto  ' })
    expect(v.status).toBe('CANCELED')
    expect(v.cancelReason).toBe('imprevisto')
    expect(v.canceledAt).toEqual(hora(10))
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })
    expect([row.canceledByType, row.canceledById]).toEqual(['CUSTOMER', cli.id])
  })

  test('a equipe cancela a qualquer hora; motivo vazio vira null e acima de 300 caracteres é recusado', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(8, 30) })
    const longo = await domainError(cancelAppointment(s.gerente, a.id, { reason: 'x'.repeat(301) }))
    expect(longo.code).toBe('validation')
    const v = await cancelAppointment(s.gerente, a.id, { reason: '   ' })
    expect(v.status).toBe('CANCELED')
    expect(v.cancelReason).toBeNull()
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })
    expect(row.canceledByType).toBe('MEMBER')
    expect(row.canceledById).toBe(memberOf(s.gerente).userId)
  })

  test('cancelado libera o horário e cancelar de novo ou de COMPLETED dá invalid_transition', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    await cancelAppointment(s.gerente, a.id)
    const e = await domainError(cancelAppointment(s.gerente, a.id))
    expect(e.reason).toBe('invalid_transition')
    await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const feito = await makeAppointment(s.b.id, {
      customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(14), status: 'COMPLETED',
    })
    const c = await domainError(cancelAppointment(s.gerente, feito.id))
    expect(c.code).toBe('conflict')
    expect(c.reason).toBe('invalid_transition')
  })

  test('cliente só cancela PENDING ou CONFIRMED', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const feito = await makeAppointment(s.b.id, {
      customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(14), status: 'COMPLETED',
    })
    const dono = await customerCtx(s.b, s.now, cli.id)
    expect((await domainError(cancelAppointment(dono, feito.id))).reason).toBe('invalid_transition')
  })
})

describe('remarcar', () => {
  test('mantém o id, muda os horários e grava auditoria', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const r = await rescheduleAppointment(s.cliente, v.id, { startsAt: hora(14) })
    expect(r.id).toBe(v.id)
    expect(r.local).toEqual({ date: '2026-11-16', start: '14:00', end: '15:00' })
    expect(r.professional.id).toBe(s.ana.id)
    expect(r.status).toBe('CONFIRMED')
    expect(await total(s.b.id)).toBe(1)
    expect((await audits(s.b.id, 'appointment.rescheduled')).map((a) => a.targetId)).toEqual([v.id])
  })

  test('com serviceIds refaz itens, total e fim', async () => {
    const s = await montar()
    const v = await bookAppointment(s.gerente, { customerId: (await makeCustomer(s.b.id)).id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const r = await rescheduleAppointment(s.gerente, v.id, { startsAt: DEZ, serviceIds: [s.tosa.id, s.banho.id] })
    expect(r.items.map((i) => i.name)).toEqual(['Tosa', 'Banho'])
    expect(r.totalCents).toBe(13000)
    expect(r.totalDurationMin).toBe(90)
    expect(r.local.end).toBe('11:30')
    expect(await prisma.appointmentItem.count({ where: { appointmentId: v.id } })).toBe(2)
  })

  test('remarcar para o próprio horário atual funciona e para o horário de outro dá slot_taken', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect((await rescheduleAppointment(s.gerente, v.id, { startsAt: DEZ })).id).toBe(v.id)
    expect((await rescheduleAppointment(s.gerente, v.id, { startsAt: new Date('2026-11-16T13:30:00Z') })).local.start).toBe('10:30')
    await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(14) })
    const e = await domainError(rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14, 30) }))
    expect(e.reason).toBe('slot_taken')
    expect((await getAppointment(s.gerente, v.id)).local.start).toBe('10:30')
  })

  test('cliente do app remarca só para início oferecido e só dentro do prazo', async () => {
    const s = await montar()
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: hora(15) })
    const fora = await domainError(rescheduleAppointment(s.cliente, v.id, { startsAt: new Date('2026-11-16T13:10:00Z') }))
    expect(fora.reason).toBe('slot_unavailable')
    const tarde = await customerCtx(s.b, hora(14), idDe(s.cliente))
    const e = await domainError(rescheduleAppointment(tarde, v.id, { startsAt: hora(16) }))
    expect(e.reason).toBe('too_late')
    expect((await getAppointment(s.gerente, v.id)).local.start).toBe('15:00')
  })

  test('mudar de profissional libera o antigo e ocupa o novo', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const r = await rescheduleAppointment(s.gerente, v.id, { startsAt: DEZ, professionalId: s.caio.id })
    expect(r.professional.id).toBe(s.caio.id)
    const outro = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(outro.professional.id).toBe(s.ana.id)
  })

  test('agendamento cancelado ou concluído não remarca', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ, status: 'CANCELED' })
    const e = await domainError(rescheduleAppointment(s.gerente, a.id, { startsAt: hora(14) }))
    expect(e.reason).toBe('invalid_transition')
  })
})

describe('remarcar com o profissional que mudou depois da marcação', () => {
  type Mudanca = 'inativo' | 'arquivado' | 'sem o serviço'
  const casos: Mudanca[] = ['inativo', 'arquivado', 'sem o serviço']
  async function alterar(s: Awaited<ReturnType<typeof montar>>, como: Mudanca) {
    if (como === 'inativo') await prisma.professional.update({ where: { id: s.ana.id }, data: { active: false } })
    if (como === 'arquivado') await prisma.professional.update({ where: { id: s.ana.id }, data: { archivedAt: new Date('2026-11-10T00:00:00Z') } })
    if (como === 'sem o serviço') {
      await prisma.professionalService.deleteMany({ where: { professionalId: s.ana.id, serviceId: s.banho.id } })
    }
  }

  for (const como of casos) {
    test(`profissional ${como}: o cliente do app não remarca (validation em professionalId) e a equipe remarca`, async () => {
      const s = await montar()
      const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
      await alterar(s, como)
      const e = await domainError(rescheduleAppointment(s.cliente, v.id, { startsAt: hora(14) }))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('professionalId')
      expect((await getAppointment(s.gerente, v.id)).local.start).toBe('10:00')
      const g = await rescheduleAppointment(s.gerente, v.id, { startsAt: hora(14) })
      expect(g.local.start).toBe('14:00')
      expect(g.professional.id).toBe(s.ana.id)
    })
  }
})

describe('agendamento que mudou de profissional entre a leitura e a trava', () => {
  /** Segura a trava de Ana, deixa a operação ler e esperar, move o agendamento para Caio e solta. */
  async function moverEnquantoEspera(s: Awaited<ReturnType<typeof montar>>, id: string, operacao: () => Promise<unknown>) {
    let soltar!: () => void
    const segura = new Promise<void>((resolve) => (soltar = resolve))
    let travou!: () => void
    const travada = new Promise<void>((resolve) => (travou = resolve))
    const dono = s.gerente.db.$transaction(async (tx) => {
      await tx.$lockKey('professional', s.ana.id)
      travou()
      await segura
      await tx.appointment.update({ where: { id }, data: { professionalId: s.caio.id } })
    })
    await travada
    const op = operacao().then(
      () => null,
      (e: unknown) => e,
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    soltar()
    await dono
    return op
  }

  test('ajustar, cancelar e concluir recebem conflict changed e nada é gravado', async () => {
    const s = await montar({ now: hora(12) })
    const cli = await makeCustomer(s.b.id)
    const casos: [string, (id: string) => Promise<unknown>][] = [
      ['ajustar', (id) => adjustAppointment(s.gerente, id, { serviceIds: [s.banho.id, s.tosa.id] })],
      ['cancelar', (id) => cancelAppointment(s.gerente, id)],
      ['concluir', (id) => completeAppointment(s.gerente, id)],
    ]
    for (const [nome, operacao] of casos) {
      const ag = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
      const erro = await moverEnquantoEspera(s, ag.id, () => operacao(ag.id))
      expect(erro, nome).toBeInstanceOf(DomainError)
      expect((erro as DomainError).code, nome).toBe('conflict')
      expect((erro as DomainError).reason, nome).toBe('changed')
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id }, include: { items: true } })
      expect([row.status, row.professionalId, row.items.length], nome).toEqual(['CONFIRMED', s.caio.id, 1])
      await prisma.appointment.delete({ where: { id: ag.id } })
    }
  })

  test('ajustar e remarcar para outro profissional em paralelo: o ajuste é sempre recusado e a remarcação passa', async () => {
    for (let n = 0; n < 10; n++) {
      const s = await montar()
      const cli = await makeCustomer(s.b.id)
      const ag = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
      await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(11) })
      const rs = await Promise.allSettled([
        adjustAppointment(s.gerente, ag.id, { serviceIds: [s.banho.id, s.tosa.id] }),
        rescheduleAppointment(s.gerente, ag.id, { startsAt: DEZ, professionalId: s.caio.id }),
      ])
      // O ajuste (90 min) invade o agendamento de Ana às 11:00 ou encontra o agendamento já movido: nunca passa.
      expect(rs[0].status).toBe('rejected')
      if (rs[0].status === 'rejected') {
        expect(rs[0].reason).toBeInstanceOf(DomainError)
        expect(['changed', 'slot_taken']).toContain((rs[0].reason as DomainError).reason)
      }
      expect(rs[1].status).toBe('fulfilled')
      const todos = await prisma.appointment.findMany({ where: { businessId: s.b.id }, orderBy: { startsAt: 'asc' } })
      for (const a of todos) {
        for (const o of todos) {
          if (a.id !== o.id && a.professionalId === o.professionalId) {
            expect(a.startsAt.getTime() < o.endsAt.getTime() && o.startsAt.getTime() < a.endsAt.getTime()).toBe(false)
          }
        }
      }
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id }, include: { items: true } })
      expect(row.professionalId).toBe(s.caio.id)
      const duracao = row.items.reduce((sum, i) => sum + i.durationMin, 0)
      expect(row.totalDurationMin).toBe(duracao)
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(duracao * 60_000)
    }
  })
})

describe('situação', () => {
  test('confirmar PENDING; confirmar de novo dá invalid_transition', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { autoConfirm: false } })
    const v = await bookAppointment(s.cliente, { professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect((await confirmAppointment(s.gerente, v.id)).status).toBe('CONFIRMED')
    expect((await domainError(confirmAppointment(s.gerente, v.id))).reason).toBe('invalid_transition')
  })

  test('concluir antes do início dá too_early; depois grava comissão e completedAt', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const cedo = await domainError(completeAppointment(s.gerente, v.id))
    expect(cedo.code).toBe('conflict')
    expect(cedo.reason).toBe('too_early')
    const depois = await makeCtx(s.b, { actor: s.gerente.actor, now: hora(10, 30) })
    const feito = await completeAppointment(depois, v.id)
    expect(feito.status).toBe('COMPLETED')
    expect(feito.commissionCents).toBe(3600)
    expect(feito.completedAt).toEqual(hora(10, 30))
  })

  test('a comissão vale a do momento da conclusão', async () => {
    const s = await montar({ now: hora(12) })
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    await prisma.professional.update({ where: { id: s.ana.id }, data: { commissionBps: 3333 } })
    const v = await completeAppointment(s.gerente, a.id)
    expect(v.commissionCents).toBe(Math.round((8000 * 3333) / 10000))
  })

  test('desfazer volta a CONFIRMED e zera comissão e completedAt', async () => {
    const s = await montar({ now: hora(12) })
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    await completeAppointment(s.gerente, a.id)
    const v = await undoOutcome(s.gerente, a.id)
    expect(v.status).toBe('CONFIRMED')
    expect(v.commissionCents).toBeNull()
    expect(v.completedAt).toBeNull()
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })
    expect([row.commissionCents, row.completedAt]).toEqual([null, null])
    expect((await domainError(undoOutcome(s.gerente, a.id))).reason).toBe('invalid_transition')
  })

  test('falta libera o horário; desfazer a falta com o horário ocupado dá slot_taken', async () => {
    const s = await montar({ now: hora(12) })
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ })
    const cedo = await makeCtx(s.b, { actor: s.gerente.actor, now: hora(9) })
    expect((await domainError(markNoShow(cedo, a.id))).reason).toBe('too_early')
    expect((await markNoShow(s.gerente, a.id)).status).toBe('NO_SHOW')
    const novo = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    expect(novo.id).not.toBe(a.id)
    const e = await domainError(undoOutcome(s.gerente, a.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('slot_taken')
    expect(e.message).toBe('Não dá para desfazer: o horário já está ocupado por outro agendamento.')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('NO_SHOW')
  })

  test('concluir ou marcar falta de PENDING ou CANCELED dá invalid_transition', async () => {
    const s = await montar({ now: hora(12) })
    const cli = await makeCustomer(s.b.id)
    const p = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ, status: 'PENDING' })
    const c = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.caio.id, serviceId: s.banho.id, startsAt: DEZ, status: 'CANCELED' })
    for (const id of [p.id, c.id]) {
      expect((await domainError(completeAppointment(s.gerente, id))).reason).toBe('invalid_transition')
      expect((await domainError(markNoShow(s.gerente, id))).reason).toBe('invalid_transition')
    }
  })
})

describe('adjustAppointment', () => {
  test('totalCents informado muda só o total', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const r = await adjustAppointment(s.gerente, v.id, { totalCents: 6000 })
    expect(r.totalCents).toBe(6000)
    expect(r.endsAt).toEqual(v.endsAt)
    expect(r.items).toEqual(v.items)
    const invalido = await domainError(adjustAppointment(s.gerente, v.id, { totalCents: -1 }))
    expect(invalido.code).toBe('validation')
    expect((await domainError(adjustAppointment(s.gerente, v.id, { totalCents: 10_000_001 }))).code).toBe('validation')
    expect((await adjustAppointment(s.gerente, v.id, { totalCents: 0 })).totalCents).toBe(0)
  })

  test('trocar serviços para um que invade bloqueio da agenda: blocked, com mensagem própria do ajuste', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: DEZ })
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: hora(10, 30), endsAt: hora(12), createdByType: 'SYSTEM' },
    })
    const e = await domainError(adjustAppointment(s.gerente, v.id, { serviceIds: [s.banho.id] }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('blocked')
    expect(e.message).toBe(
      'Com esses serviços o atendimento invade um bloqueio da agenda. Escolha outros serviços ou remova o bloqueio.',
    )
  })

  test('trocar serviços refaz itens, total e fim; observações até 2000 caracteres', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    const r = await adjustAppointment(s.gerente, v.id, { serviceIds: [s.banho.id, s.tosa.id], notes: ' volta cedo ' })
    expect(r.items.map((i) => i.name)).toEqual(['Banho', 'Tosa'])
    expect(r.totalCents).toBe(13000)
    expect(r.local.end).toBe('11:30')
    expect(r.notes).toBe('volta cedo')
    expect((await domainError(adjustAppointment(s.gerente, v.id, { notes: 'x'.repeat(2001) }))).code).toBe('validation')
    expect((await adjustAppointment(s.gerente, v.id, { notes: '' })).notes).toBeNull()
    const comPreco = await adjustAppointment(s.gerente, v.id, { serviceIds: [s.tosa.id], totalCents: 100 })
    expect([comPreco.totalCents, comPreco.local.end]).toEqual([100, '10:30'])
  })

  test('estender para cima do próximo agendamento é recusado e nada muda', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const v = await bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.banho.id], startsAt: DEZ })
    await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: hora(11) })
    const e = await domainError(adjustAppointment(s.gerente, v.id, { serviceIds: [s.banho.id, s.tosa.id] }))
    expect(e.reason).toBe('slot_taken')
    const depois = await getAppointment(s.gerente, v.id)
    expect(depois.items).toHaveLength(1)
    expect(depois.local.end).toBe('11:00')
  })

  test('agendamento concluído não se ajusta', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const a = await makeAppointment(s.b.id, { customerId: cli.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: DEZ, status: 'COMPLETED' })
    expect((await domainError(adjustAppointment(s.gerente, a.id, { totalCents: 1 }))).reason).toBe('invalid_transition')
  })
})

describe('auditoria', () => {
  test('cada operação deixa a linha correspondente', async () => {
    const s = await montar({ now: hora(12) })
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { autoConfirm: false } })
    const cli = await makeCustomer(s.b.id)
    const at = (h: number) => bookAppointment(s.gerente, { customerId: cli.id, professionalId: s.ana.id, serviceIds: [s.tosa.id], startsAt: hora(h) })
    const [a, b, c, d, e] = [await at(13), await at(14), await at(9), await at(15), await at(16)]
    if (!a || !b || !c || !d || !e) throw new Error('faltou agendamento')
    await rescheduleAppointment(s.gerente, a.id, { startsAt: hora(17) })
    await cancelAppointment(s.gerente, b.id)
    await completeAppointment(s.gerente, c.id)
    await undoOutcome(s.gerente, c.id)
    await adjustAppointment(s.gerente, d.id, { totalCents: 1 })
    await prisma.appointment.update({ where: { id: e.id }, data: { status: 'PENDING' } })
    await confirmAppointment(s.gerente, e.id)
    const f = await at(10)
    await markNoShow(s.gerente, f.id)
    const esperado: [string, string][] = [
      ['appointment.booked', a.id],
      ['appointment.rescheduled', a.id],
      ['appointment.canceled', b.id],
      ['appointment.completed', c.id],
      ['appointment.outcome_undone', c.id],
      ['appointment.adjusted', d.id],
      ['appointment.confirmed', e.id],
      ['appointment.no_show', f.id],
    ]
    for (const [action, id] of esperado) {
      const linhas = await audits(s.b.id, action)
      expect(linhas.map((l) => l.targetId), action).toContain(id)
      expect(linhas.every((l) => l.targetType === 'Appointment')).toBe(true)
    }
    expect((await audits(s.b.id, 'appointment.booked')).length).toBe(6)
  })
})
