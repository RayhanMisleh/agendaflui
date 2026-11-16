import { prisma } from '@/server/db/client'
import { getAvailability, loadDayOccupancy, resolveServices } from '@/server/domain/scheduling/availability'
import { localToDbDate } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeProfessional,
  makeService,
  makeWorkingHours,
} from '../setup/factories'

beforeEach(resetDb)

const MANHA = { startMin: 540, endMin: 720 }
const TARDE = { startMin: 780, endMin: 1080 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
const SEGUNDA = '2026-11-16'

async function montar(o: { timezone?: string; now?: Date; step?: number } = {}) {
  const b = await makeBusiness(o.timezone ? { timezone: o.timezone } : {})
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: o.step ?? 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const a = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id, tosa.id] })
  const c = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id, tosa.id] })
  for (const p of [a, c]) await makeWorkingHours(b.id, p.id, 'MONDAY', [MANHA, TARDE])
  const gerente = await makeCtx(b, { now: o.now ?? SEGUNDA_08H })
  const cliente = await clienteCtx(b, o.now ?? SEGUNDA_08H)
  return { b, banho, tosa, a, c, gerente, cliente }
}

async function clienteCtx(b: { id: string }, now: Date, overrides: { isClubMember?: boolean } = {}) {
  const customer = await makeCustomer(b.id, overrides)
  return makeCtx(b, { actor: { kind: 'customer', customerId: customer.id, name: customer.name }, now })
}

const labels = (v: { slots: { label: string }[] }) => v.slots.map((s) => s.label)

describe('getAvailability', () => {
  test('cliente vê os inícios da grade, com os dois profissionais, duração e total', async () => {
    const s = await montar()
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(v.date).toBe(SEGUNDA)
    expect(v.durationMin).toBe(60)
    expect(v.totalCents).toBe(8000)
    expect(labels(v)).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00',
      '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00',
    ])
    const primeiro = v.slots[0]
    expect(primeiro?.startsAt.toISOString()).toBe('2026-11-16T12:00:00.000Z')
    expect(primeiro?.professionalIds).toEqual([s.a.id, s.c.id])
    expect(Object.keys(primeiro ?? {}).sort()).toEqual(['label', 'professionalIds', 'startsAt'])
  })

  test('dois serviços somam duração e total; o último início da manhã é 10:30', async () => {
    const s = await montar()
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id, s.tosa.id] })
    expect(v.durationMin).toBe(90)
    expect(v.totalCents).toBe(13000)
    expect(labels(v).filter((l) => l < '12:00')).toEqual(['09:00', '09:30', '10:00', '10:30'])
  })

  test('agendamento ativo tira o profissional dos inícios que o cobrem; cancelado e falta não', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const dez = new Date('2026-11-16T13:00:00Z')
    const base = { customerId: cli.id, professionalId: s.a.id, serviceId: s.banho.id, startsAt: dez }
    await makeAppointment(s.b.id, { ...base, status: 'CONFIRMED' })
    await makeAppointment(s.b.id, { ...base, startsAt: new Date('2026-11-16T12:00:00Z'), status: 'CANCELED' })
    await makeAppointment(s.b.id, { ...base, startsAt: new Date('2026-11-16T12:00:00Z'), status: 'NO_SHOW' })
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    const por = new Map(v.slots.map((x) => [x.label, x.professionalIds]))
    expect(por.get('09:00')).toEqual([s.a.id, s.c.id])
    for (const l of ['09:30', '10:00', '10:30']) expect(por.get(l)).toEqual([s.c.id])
    expect(por.get('11:00')).toEqual([s.a.id, s.c.id])

    const soA = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id], professionalId: s.a.id })
    expect(labels(soA)).not.toContain('09:30')
    expect(labels(soA)).not.toContain('10:00')
    expect(labels(soA)).not.toContain('10:30')
    expect(labels(soA)).toContain('09:00')
    expect(soA.slots.every((x) => x.professionalIds.length === 1 && x.professionalIds[0] === s.a.id)).toBe(true)
  })

  test('agendamento concluído também ocupa o horário', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    await makeAppointment(s.b.id, {
      customerId: cli.id,
      professionalId: s.a.id,
      serviceId: s.banho.id,
      startsAt: new Date('2026-11-16T13:00:00Z'),
      status: 'COMPLETED',
    })
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id], professionalId: s.a.id })
    expect(labels(v)).not.toContain('10:00')
  })

  test('bloqueio de uma tarde inteira deixa só o outro profissional', async () => {
    const s = await montar()
    await prisma.timeBlock.create({
      data: {
        businessId: s.b.id,
        professionalId: s.a.id,
        startsAt: new Date('2026-11-16T16:00:00Z'),
        endsAt: new Date('2026-11-16T21:00:00Z'),
        createdByType: 'SYSTEM',
      },
    })
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    for (const x of v.slots.filter((y) => y.label >= '13:00')) expect(x.professionalIds).toEqual([s.c.id])
    for (const x of v.slots.filter((y) => y.label < '12:00')) expect(x.professionalIds).toEqual([s.a.id, s.c.id])
  })

  test('dia fechado, domingo sem expediente e data passada devolvem lista vazia', async () => {
    const s = await montar()
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: localToDbDate('2026-11-23'), endDate: localToDbDate('2026-11-23') },
    })
    for (const ctx of [s.cliente, s.gerente]) {
      expect((await getAvailability(ctx, { date: '2026-11-23', serviceIds: [s.banho.id] })).slots).toEqual([])
      expect((await getAvailability(ctx, { date: '2026-11-22', serviceIds: [s.banho.id] })).slots).toEqual([])
      expect((await getAvailability(ctx, { date: '2026-11-15', serviceIds: [s.banho.id] })).slots).toEqual([])
    }
    const v = await getAvailability(s.cliente, { date: '2026-11-15', serviceIds: [s.banho.id] })
    expect(v).toMatchObject({ date: '2026-11-15', durationMin: 60, totalCents: 8000 })
  })

  test('data além do alcance some para o cliente e continua para a equipe', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { maxAdvanceDays: 7 } })
    const dentro = await getAvailability(s.cliente, { date: '2026-11-23', serviceIds: [s.banho.id] })
    expect(dentro.slots.length).toBeGreaterThan(0)
    const fora = await getAvailability(s.cliente, { date: '2026-11-30', serviceIds: [s.banho.id] })
    expect(fora.slots).toEqual([])
    const equipe = await getAvailability(s.gerente, { date: '2026-11-30', serviceIds: [s.banho.id] })
    expect(equipe.slots.length).toBeGreaterThan(0)
  })

  test('antecedência vale para o cliente; a equipe começa agora', async () => {
    const s = await montar({ now: new Date('2026-11-16T13:10:00Z') })
    const cliente = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(cliente.slots[0]?.label).toBe('13:00')
    const gerente = await getAvailability(s.gerente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(gerente.slots[0]?.label).toBe('10:30')
  })

  test('profissional que não faz todos os serviços fica de fora', async () => {
    const s = await montar()
    const soBanho = await makeProfessional(s.b.id, { name: 'Bia', displayOrder: 0, serviceIds: [s.banho.id] })
    await makeWorkingHours(s.b.id, soBanho.id, 'MONDAY', [MANHA])
    const dois = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id, s.tosa.id] })
    expect(dois.slots.flatMap((x) => x.professionalIds)).not.toContain(soBanho.id)
    const um = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(um.slots[0]?.professionalIds).toEqual([soBanho.id, s.a.id, s.c.id])
    const e = await domainError(
      getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id, s.tosa.id], professionalId: soBanho.id }),
    )
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('professionalId')
  })

  test('profissional inativo ou arquivado não é candidato', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.a.id }, data: { active: false } })
    await prisma.professional.update({ where: { id: s.c.id }, data: { archivedAt: new Date('2026-11-01T00:00:00Z') } })
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(v.slots).toEqual([])
    const e = await domainError(
      getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id], professionalId: s.a.id }),
    )
    expect(e.fields).toHaveProperty('professionalId')
  })

  test('profissional de outra conta em professionalId dá validation, sem revelar dado', async () => {
    const s = await montar()
    const outra = await makeBusiness()
    const svc = await makeService(outra.id)
    const alheio = await makeProfessional(outra.id, { serviceIds: [svc.id] })
    await makeWorkingHours(outra.id, alheio.id, 'MONDAY', [MANHA])
    const e = await domainError(
      getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id], professionalId: alheio.id }),
    )
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('professionalId')
    const malformado = await domainError(
      getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id], professionalId: 'x' }),
    )
    expect(malformado.fields).toHaveProperty('professionalId')
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(v.slots.flatMap((x) => x.professionalIds)).not.toContain(alheio.id)
  })

  test('data inválida dá validation em date', async () => {
    const s = await montar()
    const e = await domainError(getAvailability(s.cliente, { date: '2026-13-40', serviceIds: [s.banho.id] }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('date')
  })

  test('conta em Manaus devolve o início das 09:00 em UTC-4', async () => {
    const s = await montar({ timezone: 'America/Manaus', now: new Date('2026-11-16T11:00:00Z') })
    const v = await getAvailability(s.cliente, { date: SEGUNDA, serviceIds: [s.banho.id] })
    expect(v.slots[0]?.label).toBe('09:00')
    expect(v.slots[0]?.startsAt.toISOString()).toBe('2026-11-16T13:00:00.000Z')
  })

  test('agendamento que cruza a meia-noite ocupa o início do dia seguinte', async () => {
    const s = await montar({ now: new Date('2026-11-15T12:00:00Z') })
    const madrugada = await makeProfessional(s.b.id, { name: 'Dani', serviceIds: [s.tosa.id] })
    await makeWorkingHours(s.b.id, madrugada.id, 'MONDAY', [{ startMin: 0, endMin: 120 }])
    const cli = await makeCustomer(s.b.id)
    // domingo 23:30 a segunda 00:30 locais
    await makeAppointment(s.b.id, {
      customerId: cli.id,
      professionalId: madrugada.id,
      serviceId: s.tosa.id,
      startsAt: new Date('2026-11-16T02:30:00Z'),
      durationMin: 60,
    })
    const v = await getAvailability(s.gerente, { date: SEGUNDA, serviceIds: [s.tosa.id], professionalId: madrugada.id })
    expect(labels(v)).toEqual(['00:30', '01:00', '01:30'])
  })

  test('a folga vale na borda do dia: agendamento que começa à meia-noite seguinte', async () => {
    const s = await montar({ now: new Date('2026-11-15T12:00:00Z') })
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { bufferMin: 30 } })
    const noite = await makeProfessional(s.b.id, { name: 'Edu', serviceIds: [s.tosa.id] })
    await makeWorkingHours(s.b.id, noite.id, 'MONDAY', [{ startMin: 1380, endMin: 1440 }])
    const cli = await makeCustomer(s.b.id)
    await makeAppointment(s.b.id, {
      customerId: cli.id,
      professionalId: noite.id,
      serviceId: s.tosa.id,
      startsAt: new Date('2026-11-17T03:00:00Z'), // terça 00:00 local
    })
    const v = await getAvailability(s.gerente, { date: SEGUNDA, serviceIds: [s.tosa.id], professionalId: noite.id })
    expect(labels(v)).toEqual(['23:00'])
  })
})

describe('resolveServices', () => {
  test('devolve os itens na ordem pedida, com duração e total', async () => {
    const s = await montar()
    const r = await resolveServices(s.cliente, [s.tosa.id, s.banho.id])
    expect(r.items.map((i) => i.name)).toEqual(['Tosa', 'Banho'])
    expect(r.durationMin).toBe(90)
    expect(r.totalCents).toBe(13000)
  })

  test('lista vazia, repetida, grande demais, malformada, inativa, arquivada ou de outra conta dá validation', async () => {
    const s = await montar()
    const outra = await makeBusiness()
    const alheio = await makeService(outra.id)
    const inativo = await makeService(s.b.id, { active: false })
    const arquivado = await makeService(s.b.id, { archivedAt: new Date('2026-11-01T00:00:00Z') })
    const casos: string[][] = [
      [],
      [s.banho.id, s.banho.id],
      ['x'],
      [inativo.id],
      [arquivado.id],
      [alheio.id],
      [crypto.randomUUID()],
      Array.from({ length: 11 }, () => crypto.randomUUID()),
    ]
    for (const ids of casos) {
      const e = await domainError(resolveServices(s.gerente, ids))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('serviceIds')
    }
    const inexistente = await domainError(resolveServices(s.gerente, [crypto.randomUUID()]))
    const deOutra = await domainError(resolveServices(s.gerente, [alheio.id]))
    expect(deOutra.fields?.serviceIds).toBe(inexistente.fields?.serviceIds)
  })

  test('soma das durações acima de 720 minutos dá validation', async () => {
    const s = await montar()
    const l1 = await makeService(s.b.id, { durationMin: 400 })
    const l2 = await makeService(s.b.id, { durationMin: 400 })
    const e = await domainError(resolveServices(s.gerente, [l1.id, l2.id]))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('serviceIds')
    const ok = await makeService(s.b.id, { durationMin: 320 })
    expect((await resolveServices(s.gerente, [l1.id, ok.id])).durationMin).toBe(720)
  })

  test('serviço só do clube: cliente comum recebe forbidden, sócio e equipe passam', async () => {
    const s = await montar()
    const vip = await makeService(s.b.id, { clubOnly: true, durationMin: 30 })
    const e = await domainError(resolveServices(s.cliente, [vip.id]))
    expect(e.code).toBe('forbidden')
    expect(e.reason).toBe('club_only')
    const socio = await clienteCtx(s.b, SEGUNDA_08H, { isClubMember: true })
    expect((await resolveServices(socio, [vip.id])).items).toHaveLength(1)
    expect((await resolveServices(s.gerente, [vip.id])).items).toHaveLength(1)
  })
})

describe('loadDayOccupancy', () => {
  test('agrupa expediente, ocupação e bloqueios por profissional e respeita ignoreAppointmentId', async () => {
    const s = await montar()
    const cli = await makeCustomer(s.b.id)
    const ag = await makeAppointment(s.b.id, {
      customerId: cli.id,
      professionalId: s.a.id,
      serviceId: s.banho.id,
      startsAt: new Date('2026-11-16T13:00:00Z'),
    })
    await prisma.timeBlock.create({
      data: {
        businessId: s.b.id,
        professionalId: s.c.id,
        startsAt: new Date('2026-11-16T16:00:00Z'),
        endsAt: new Date('2026-11-16T17:00:00Z'),
        createdByType: 'SYSTEM',
      },
    })
    const mapa = await loadDayOccupancy(s.gerente, { professionalIds: [s.a.id, s.c.id], date: SEGUNDA })
    expect(mapa.get(s.a.id)).toEqual({
      workingRanges: [MANHA, TARDE],
      busy: [{ start: ag.startsAt, end: ag.endsAt }],
      blocked: [],
    })
    expect(mapa.get(s.c.id)?.busy).toEqual([])
    expect(mapa.get(s.c.id)?.blocked).toEqual([
      { start: new Date('2026-11-16T16:00:00Z'), end: new Date('2026-11-16T17:00:00Z') },
    ])
    const sem = await loadDayOccupancy(s.gerente, {
      professionalIds: [s.a.id],
      date: SEGUNDA,
      ignoreAppointmentId: ag.id,
    })
    expect(sem.get(s.a.id)?.busy).toEqual([])
  })
})
