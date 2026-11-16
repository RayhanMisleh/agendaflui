import pg from 'pg'
import { prisma } from '@/server/db/client'
import { getAvailability, listAvailableDays } from '@/server/domain/scheduling/availability'
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

const UMA_HORA = { startMin: 540, endMin: 600 }
const MANHA = { startMin: 540, endMin: 720 }
/** Segunda-feira, 08:00 em São Paulo. */
const SEGUNDA_08H = new Date('2026-11-16T11:00:00Z')
const sp = (dia: number, h: number): Date => new Date(Date.UTC(2026, 10, dia, h + 3))

async function montar() {
  const b = await makeBusiness()
  await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30 } })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id] })
  // Segunda e quinta com expediente; terça tem expediente mas a conta fecha; quarta tem uma hora só e fica lotada.
  for (const p of [ana, caio]) {
    await makeWorkingHours(b.id, p.id, 'MONDAY', [MANHA])
    await makeWorkingHours(b.id, p.id, 'TUESDAY', [MANHA])
    await makeWorkingHours(b.id, p.id, 'WEDNESDAY', [UMA_HORA])
    await makeWorkingHours(b.id, p.id, 'THURSDAY', [MANHA])
  }
  await prisma.businessClosure.create({
    data: { businessId: b.id, startDate: new Date('2026-11-17T00:00:00Z'), endDate: new Date('2026-11-17T00:00:00Z') },
  })
  const dono = await makeCustomer(b.id)
  for (const p of [ana, caio]) {
    await makeAppointment(b.id, { customerId: dono.id, professionalId: p.id, serviceId: banho.id, startsAt: sp(18, 9) })
  }
  const gerente = await makeCtx(b, { now: SEGUNDA_08H })
  const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: dono.id, name: dono.name }, now: SEGUNDA_08H })
  return { b, banho, ana, caio, gerente, cliente }
}

describe('listAvailableDays', () => {
  test('de segunda a domingo: livre só onde há horário livre', async () => {
    const s = await montar()
    const dias = await listAvailableDays(s.cliente, { from: '2026-11-16', to: '2026-11-22', serviceIds: [s.banho.id] })
    expect(dias).toEqual([
      { date: '2026-11-16', weekday: 'MONDAY', available: true },
      { date: '2026-11-17', weekday: 'TUESDAY', available: false },
      { date: '2026-11-18', weekday: 'WEDNESDAY', available: false },
      { date: '2026-11-19', weekday: 'THURSDAY', available: true },
      { date: '2026-11-20', weekday: 'FRIDAY', available: false },
      { date: '2026-11-21', weekday: 'SATURDAY', available: false },
      { date: '2026-11-22', weekday: 'SUNDAY', available: false },
    ])
  })

  test('um profissional específico só conta o horário dele', async () => {
    const s = await montar()
    await makeAppointment(s.b.id, {
      customerId: (await makeCustomer(s.b.id)).id,
      professionalId: s.ana.id,
      serviceId: s.banho.id,
      startsAt: sp(19, 9),
      durationMin: 180,
    })
    const dias = await listAvailableDays(s.gerente, {
      from: '2026-11-19',
      to: '2026-11-19',
      serviceIds: [s.banho.id],
      professionalId: s.ana.id,
    })
    expect(dias).toEqual([{ date: '2026-11-19', weekday: 'THURSDAY', available: false }])
    const caio = await listAvailableDays(s.gerente, {
      from: '2026-11-19',
      to: '2026-11-19',
      serviceIds: [s.banho.id],
      professionalId: s.caio.id,
    })
    expect(caio[0]?.available).toBe(true)
  })

  test('dia que já passou não tem horário livre', async () => {
    const s = await montar()
    const dias = await listAvailableDays(s.gerente, { from: '2026-11-09', to: '2026-11-09', serviceIds: [s.banho.id] })
    expect(dias).toEqual([{ date: '2026-11-09', weekday: 'MONDAY', available: false }])
  })

  test('o número de consultas não cresce com os dias', async () => {
    const s = await montar()
    const contar = async (to: string): Promise<number> => {
      let n = 0
      const original = pg.Client.prototype.query
      pg.Client.prototype.query = function contado(this: pg.Client, ...args: unknown[]) {
        n += 1
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      } as typeof original
      try {
        await listAvailableDays(s.cliente, { from: '2026-11-16', to, serviceIds: [s.banho.id] })
      } finally {
        pg.Client.prototype.query = original
      }
      return n
    }
    const um = await contar('2026-11-16')
    const sete = await contar('2026-11-22')
    const trinta = await contar('2026-12-16')
    expect(um).toBeGreaterThan(0)
    expect(sete).toBe(um)
    expect(trinta).toBe(um)
  })

  test('recusa intervalo de 32 dias, intervalo invertido e data inválida', async () => {
    const s = await montar()
    const ok = await listAvailableDays(s.gerente, { from: '2026-11-16', to: '2026-12-16', serviceIds: [s.banho.id] })
    expect(ok).toHaveLength(31)
    const longo = await domainError(
      listAvailableDays(s.gerente, { from: '2026-11-16', to: '2026-12-17', serviceIds: [s.banho.id] }),
    )
    expect(longo.code).toBe('validation')
    expect(longo.fields?.['to']).toMatch(/31 dias/)
    const invertido = await domainError(
      listAvailableDays(s.gerente, { from: '2026-11-20', to: '2026-11-19', serviceIds: [s.banho.id] }),
    )
    expect(invertido.code).toBe('validation')
    const ruim = await domainError(listAvailableDays(s.gerente, { from: '16/11', to: '2026-11-19', serviceIds: [s.banho.id] }))
    expect(ruim.fields?.['from']).toBeDefined()
  })

  test('as mesmas validações de getAvailability: serviços e profissional', async () => {
    const s = await montar()
    const q = { from: '2026-11-16', to: '2026-11-16' }
    expect((await domainError(listAvailableDays(s.gerente, { ...q, serviceIds: [] }))).fields?.['serviceIds']).toBeDefined()
    const outro = await makeProfessional(s.b.id, { name: 'Sem serviço' })
    const e = await domainError(listAvailableDays(s.gerente, { ...q, serviceIds: [s.banho.id], professionalId: outro.id }))
    expect(e.fields?.['professionalId']).toBeDefined()
  })
})

describe('listAvailableDays: regras do cliente e da folga', () => {
  test('além de maxAdvanceDays vem false para o cliente (e true para a equipe); o último dia permitido vem true', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { maxAdvanceDays: 7 } })
    for (const p of [s.ana, s.caio]) await makeWorkingHours(s.b.id, p.id, 'TUESDAY', [MANHA])
    const q = { from: '2026-11-23', to: '2026-11-24', serviceIds: [s.banho.id] }
    expect((await listAvailableDays(s.cliente, q)).map((d) => [d.date, d.available])).toEqual([
      ['2026-11-23', true],
      ['2026-11-24', false],
    ])
    expect((await listAvailableDays(s.gerente, q)).map((d) => d.available)).toEqual([true, true])
  })

  test('dia em que só sobra horário antes da antecedência mínima vem false para o cliente', async () => {
    const s = await montar()
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { minLeadMin: 120 } })
    // Segunda 11:00 em São Paulo; expediente até 12:00: o único início (11:00) fica antes da antecedência.
    const agora = new Date('2026-11-16T14:00:00Z')
    const customer = await makeCustomer(s.b.id)
    const cliente = await makeCtx(s.b, { actor: { kind: 'customer', customerId: customer.id, name: customer.name }, now: agora })
    const equipe = await makeCtx(s.b, { now: agora })
    const q = { from: '2026-11-16', to: '2026-11-16', serviceIds: [s.banho.id] }
    expect((await listAvailableDays(cliente, q))[0]?.available).toBe(false)
    expect((await listAvailableDays(equipe, q))[0]?.available).toBe(true)
  })

  test('a folga vale na borda do dia: agendamento até 23:50 da véspera tira o início das 00:00', async () => {
    const b = await makeBusiness()
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { slotStepMin: 30, bufferMin: 15 } })
    const corte = await makeService(b.id, { name: 'Corte', durationMin: 30 })
    const noturno = await makeProfessional(b.id, { name: 'Noturno', serviceIds: [corte.id] })
    await makeWorkingHours(b.id, noturno.id, 'TUESDAY', [{ startMin: 0, endMin: 30 }])
    const dono = await makeCustomer(b.id)
    // Segunda 23:20 a 23:50 em São Paulo.
    await makeAppointment(b.id, {
      customerId: dono.id,
      professionalId: noturno.id,
      serviceId: corte.id,
      startsAt: new Date(Date.UTC(2026, 10, 16, 23 + 3, 20)),
    })
    const gerente = await makeCtx(b, { now: SEGUNDA_08H })
    const q = { from: '2026-11-17', to: '2026-11-17', serviceIds: [corte.id] }
    expect((await listAvailableDays(gerente, q))[0]?.available).toBe(false)
    expect((await getAvailability(gerente, { date: '2026-11-17', serviceIds: [corte.id] })).slots).toEqual([])
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { bufferMin: 0 } })
    expect((await listAvailableDays(gerente, q))[0]?.available).toBe(true)
  })

  test('para cada dia de uma semana, available é igual a getAvailability(dia).slots.length > 0', async () => {
    const s = await montar()
    // Quinta lotada por 3 horas nos dois profissionais; sexta com bloqueio no dia todo de um e folga do outro.
    for (const p of [s.ana, s.caio]) {
      await makeAppointment(s.b.id, {
        customerId: (await makeCustomer(s.b.id)).id,
        professionalId: p.id,
        serviceId: s.banho.id,
        startsAt: sp(19, 9),
        durationMin: 180,
      })
    }
    await makeWorkingHours(s.b.id, s.ana.id, 'FRIDAY', [MANHA])
    await prisma.timeBlock.create({
      data: { businessId: s.b.id, professionalId: s.ana.id, startsAt: sp(20, 0), endsAt: sp(21, 0), createdByType: 'SYSTEM' },
    })
    for (const ctx of [s.cliente, s.gerente]) {
      const q = { from: '2026-11-16', to: '2026-11-22', serviceIds: [s.banho.id] }
      const dias = await listAvailableDays(ctx, q)
      expect(dias).toHaveLength(7)
      for (const d of dias) {
        const v = await getAvailability(ctx, { date: d.date, serviceIds: [s.banho.id] })
        expect(d.available, d.date).toBe(v.slots.length > 0)
      }
      expect(dias.some((d) => d.available)).toBe(true)
      expect(dias.some((d) => !d.available)).toBe(true)
    }
  })
})

