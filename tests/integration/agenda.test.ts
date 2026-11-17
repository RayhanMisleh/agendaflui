import pg from 'pg'
import { prisma } from '@/server/db/client'
import {
  getAgenda,
  getDaySummary,
  getNextAppointment,
  listCustomerAppointments,
} from '@/server/domain/scheduling/agenda'
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
const AGORA = new Date('2026-11-16T11:00:00Z')
const SP = 'America/Sao_Paulo'
const MANAUS = 'America/Manaus'

/** Instante de uma hora local de São Paulo (UTC-3) em 2026-11-<dia>. */
const sp = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 3, m))

async function montar(o: { timezone?: string; now?: Date } = {}) {
  const b = await makeBusiness({ timezone: o.timezone ?? SP })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const tosa = await makeService(b.id, { name: 'Tosa', durationMin: 30, priceCents: 5000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id, tosa.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [banho.id, tosa.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'MONDAY', [MANHA, TARDE])
  const now = o.now ?? AGORA
  const gerente = await ctxWithRole(b, 'MANAGER', { now })
  const cliente = await makeCustomer(b.id)
  return { b, banho, tosa, ana, caio, gerente, cliente, now }
}

type Montagem = Awaited<ReturnType<typeof montar>>

function marcar(s: Montagem, o: { startsAt: Date; professionalId?: string; serviceId?: string; customerId?: string; status?: 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'COMPLETED' | 'NO_SHOW'; durationMin?: number }) {
  return makeAppointment(s.b.id, {
    customerId: o.customerId ?? s.cliente.id,
    professionalId: o.professionalId ?? s.ana.id,
    serviceId: o.serviceId ?? s.banho.id,
    startsAt: o.startsAt,
    ...(o.status ? { status: o.status } : {}),
    ...(o.durationMin ? { durationMin: o.durationMin } : {}),
  })
}

function bloquear(b: { id: string }, professionalId: string, startsAt: Date, endsAt: Date, reason: string | null = null) {
  return prisma.timeBlock.create({
    data: { businessId: b.id, professionalId, startsAt, endsAt, reason, createdByType: 'SYSTEM' },
  })
}

async function comoCliente(s: Montagem, customerId: string) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })
  return makeCtx(s.b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now: s.now })
}

async function comoProfissional(s: Montagem, professionalId: string | null) {
  const ctx = await ctxWithRole(s.b, 'PROFESSIONAL', { now: s.now })
  if (professionalId) {
    await prisma.professional.update({ where: { id: professionalId }, data: { membershipId: memberOf(ctx).membershipId } })
  }
  return ctx
}

describe('getAgenda: dias, profissionais e expediente', () => {
  test('a semana de 16 a 22/11 tem 7 dias com o dia da semana certo e o expediente de segunda', async () => {
    const s = await montar()
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-22' })
    expect(dias.map((d) => [d.date, d.weekday])).toEqual([
      ['2026-11-16', 'MONDAY'],
      ['2026-11-17', 'TUESDAY'],
      ['2026-11-18', 'WEDNESDAY'],
      ['2026-11-19', 'THURSDAY'],
      ['2026-11-20', 'FRIDAY'],
      ['2026-11-21', 'SATURDAY'],
      ['2026-11-22', 'SUNDAY'],
    ])
    expect(dias.every((d) => !d.closed && d.closureReason === null)).toBe(true)
    const segunda = dias[0]
    expect(segunda?.professionals.map((p) => p.name)).toEqual(['Ana', 'Caio'])
    expect(segunda?.professionals[0]?.workingRanges).toEqual([
      { startMin: 540, endMin: 720, start: '09:00', end: '12:00' },
      { startMin: 780, endMin: 1080, start: '13:00', end: '18:00' },
    ])
    expect(dias[1]?.professionals[0]?.workingRanges).toEqual([])
    expect(dias.every((d) => d.professionals.every((p) => p.appointments.length === 0 && p.blocks.length === 0))).toBe(true)
  })

  test('agendamento às 23:30 locais de segunda aparece na segunda, não na terça', async () => {
    const s = await montar()
    const a = await marcar(s, { startsAt: new Date('2026-11-17T02:30:00Z') })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    const segunda = dias[0]?.professionals.find((p) => p.id === s.ana.id)
    const terca = dias[1]?.professionals.find((p) => p.id === s.ana.id)
    expect(segunda?.appointments.map((x) => x.id)).toEqual([a.id])
    expect(segunda?.appointments[0]?.local).toEqual({ date: '2026-11-16', start: '23:30', end: '00:30' })
    expect(terca?.appointments).toEqual([])
  })

  test('em conta de Manaus o mesmo instante aparece na segunda às 22:30', async () => {
    const s = await montar({ timezone: MANAUS })
    const a = await marcar(s, { startsAt: new Date('2026-11-17T02:30:00Z'), durationMin: 30 })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    const segunda = dias[0]?.professionals.find((p) => p.id === s.ana.id)
    expect(segunda?.appointments.map((x) => x.id)).toEqual([a.id])
    expect(segunda?.appointments[0]?.local).toEqual({ date: '2026-11-16', start: '22:30', end: '23:00' })
    expect(dias[1]?.professionals.every((p) => p.appointments.length === 0)).toBe(true)
  })

  test('os limites do intervalo seguem o fuso: 00:00 local entra, a virada seguinte não', async () => {
    const s = await montar({ timezone: MANAUS })
    // Manaus é UTC-4: terça 00:00 local = 04:00Z.
    const meiaNoite = await marcar(s, { startsAt: new Date('2026-11-17T04:00:00Z'), durationMin: 30 })
    const antes = await marcar(s, { startsAt: new Date('2026-11-17T03:59:00Z'), durationMin: 30, professionalId: s.caio.id })
    const depois = await marcar(s, { startsAt: new Date('2026-11-18T04:00:00Z'), durationMin: 30 })
    const dias = await getAgenda(s.gerente, { from: '2026-11-17', to: '2026-11-17' })
    const ids = dias[0]?.professionals.flatMap((p) => p.appointments.map((x) => x.id))
    expect(ids).toEqual([meiaNoite.id])
    expect(ids).not.toContain(antes.id)
    expect(ids).not.toContain(depois.id)
  })

  test('agendamentos do dia vêm por horário e, no empate, por id', async () => {
    const s = await montar()
    const tarde = await marcar(s, { startsAt: sp(16, 15) })
    const manha = await marcar(s, { startsAt: sp(16, 9) })
    // Cancelados podem coincidir com um agendamento ativo: serve para provar o desempate por id.
    const a = await marcar(s, { startsAt: sp(16, 11), status: 'CANCELED' })
    const b = await marcar(s, { startsAt: sp(16, 11), status: 'CANCELED' })
    const [primeiro, segundo] = [a.id, b.id].sort()
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', includeCanceled: true })
    const ana = dias[0]?.professionals.find((p) => p.id === s.ana.id)
    expect(ana?.appointments.map((x) => x.id)).toEqual([manha.id, primeiro, segundo, tarde.id])
  })

  test('cancelado só aparece com includeCanceled', async () => {
    const s = await montar()
    const ok = await marcar(s, { startsAt: sp(16, 9) })
    const cancelado = await marcar(s, { startsAt: sp(16, 10), status: 'CANCELED' })
    const faltou = await marcar(s, { startsAt: sp(16, 11), status: 'NO_SHOW' })
    const sem = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
    expect(sem[0]?.professionals[0]?.appointments.map((x) => x.id)).toEqual([ok.id, faltou.id])
    const com = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', includeCanceled: true })
    expect(com[0]?.professionals[0]?.appointments.map((x) => x.id)).toEqual([ok.id, cancelado.id, faltou.id])
  })

  test('dia fechado vem com closed, o motivo e os profissionais com o que existir', async () => {
    const s = await montar()
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-17T00:00:00Z'), endDate: new Date('2026-11-18T00:00:00Z'), reason: 'Reforma' },
    })
    const a = await marcar(s, { startsAt: sp(17, 10) })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-19' })
    expect(dias.map((d) => [d.date, d.closed, d.closureReason])).toEqual([
      ['2026-11-16', false, null],
      ['2026-11-17', true, 'Reforma'],
      ['2026-11-18', true, 'Reforma'],
      ['2026-11-19', false, null],
    ])
    expect(dias[1]?.professionals.map((p) => p.name)).toEqual(['Ana', 'Caio'])
    expect(dias[1]?.professionals[0]?.appointments.map((x) => x.id)).toEqual([a.id])
  })

  test('o motivo do fechamento só vai para quem gerencia as configurações; os demais veem só que o dia está fechado', async () => {
    const s = await montar()
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-17T00:00:00Z'), endDate: new Date('2026-11-17T00:00:00Z'), reason: 'Reforma' },
    })
    const q = { from: '2026-11-17', to: '2026-11-17' }
    const gerente = await getAgenda(s.gerente, q)
    expect([gerente[0]?.closed, gerente[0]?.closureReason]).toEqual([true, 'Reforma'])
    const prof = await comoProfissional(s, s.ana.id)
    const dia = (await getAgenda(prof, q))[0]
    expect([dia?.closed, dia?.closureReason]).toEqual([true, null])
  })

  test('profissionais seguem displayOrder, nome e id; inativos e arquivados ficam de fora', async () => {
    const s = await montar()
    const zed = await makeProfessional(s.b.id, { name: 'Zed', displayOrder: 0 })
    const bia = await makeProfessional(s.b.id, { name: 'Bia', displayOrder: 1 })
    await makeProfessional(s.b.id, { name: 'Inativo', active: false })
    await makeProfessional(s.b.id, { name: 'Arquivado', archivedAt: AGORA })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
    expect(dias[0]?.professionals.map((p) => p.id)).toEqual([zed.id, s.ana.id, bia.id, s.caio.id])
  })

  test('professionalId filtra para uma coluna; id de outra conta ou malformado é not_found', async () => {
    const s = await montar()
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', professionalId: s.caio.id })
    expect(dias[0]?.professionals.map((p) => p.id)).toEqual([s.caio.id])
    const outra = await montar()
    expect((await domainError(getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', professionalId: outra.ana.id }))).code).toBe('not_found')
    expect((await domainError(getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', professionalId: 'abc' }))).code).toBe('not_found')
  })
})

describe('getAgenda: bloqueios', () => {
  test('bloqueio de segunda 22:00 a terça 02:00 aparece nos dois dias com rótulos recortados', async () => {
    const s = await montar()
    const bloco = await bloquear(s.b, s.ana.id, sp(16, 22), sp(17, 2), 'Médico')
    const dias = await getAgenda(s.gerente, { from: '2026-11-15', to: '2026-11-18' })
    const deAna = (i: number) => dias[i]?.professionals.find((p) => p.id === s.ana.id)?.blocks
    expect(deAna(0)).toEqual([])
    expect(deAna(1)).toEqual([
      { id: bloco.id, professionalId: s.ana.id, startsAt: sp(16, 22), endsAt: sp(17, 2), reason: 'Médico', local: { startDate: '2026-11-16', startTime: '22:00', endDate: '2026-11-16', endTime: '24:00' } },
    ])
    expect(deAna(2)?.map((x) => [x.id, x.local])).toEqual([[bloco.id, { startDate: '2026-11-17', startTime: '00:00', endDate: '2026-11-17', endTime: '02:00' }]])
    expect(deAna(3)).toEqual([])
    expect(dias[1]?.professionals.find((p) => p.id === s.caio.id)?.blocks).toEqual([])
  })

  test('bloqueio de vários dias mostra 00:00 a 24:00 nos dias do meio', async () => {
    const s = await montar()
    const bloco = await bloquear(s.b, s.ana.id, sp(16, 18), sp(19, 9))
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-19' })
    const locais = dias.map((d) => d.professionals.find((p) => p.id === s.ana.id)?.blocks.map((x) => [x.id, x.local.startTime, x.local.endTime]))
    expect(locais).toEqual([
      [[bloco.id, '18:00', '24:00']],
      [[bloco.id, '00:00', '24:00']],
      [[bloco.id, '00:00', '24:00']],
      [[bloco.id, '00:00', '09:00']],
    ])
  })

  test('bloqueio que termina à meia-noite exata não toca o dia seguinte; o do mesmo dia usa a hora local', async () => {
    const s = await montar({ timezone: MANAUS })
    // Manaus UTC-4: 14:00-16:30 locais de segunda e bloqueio até a meia-noite de terça (04:00Z).
    const meio = await bloquear(s.b, s.ana.id, new Date('2026-11-16T18:00:00Z'), new Date('2026-11-16T20:30:00Z'))
    const ate = await bloquear(s.b, s.caio.id, new Date('2026-11-17T02:00:00Z'), new Date('2026-11-17T04:00:00Z'))
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    expect(dias[0]?.professionals.find((p) => p.id === s.ana.id)?.blocks.map((x) => [x.id, x.local])).toEqual([[meio.id, { startDate: '2026-11-16', startTime: '14:00', endDate: '2026-11-16', endTime: '16:30' }]])
    expect(dias[0]?.professionals.find((p) => p.id === s.caio.id)?.blocks.map((x) => [x.id, x.local])).toEqual([[ate.id, { startDate: '2026-11-16', startTime: '22:00', endDate: '2026-11-16', endTime: '24:00' }]])
    expect(dias[1]?.professionals.find((p) => p.id === s.caio.id)?.blocks).toEqual([])
  })

  test('bloqueios do dia vêm por horário de início', async () => {
    const s = await montar()
    const tarde = await bloquear(s.b, s.ana.id, sp(16, 15), sp(16, 16))
    const manha = await bloquear(s.b, s.ana.id, sp(16, 9), sp(16, 10))
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
    expect(dias[0]?.professionals[0]?.blocks.map((x) => x.id)).toEqual([manha.id, tarde.id])
  })
})

describe('getAgenda: quem pode ver o quê', () => {
  test('o profissional vê só a própria coluna, com o motivo do bloqueio, e recebe forbidden ao pedir a de um colega', async () => {
    const s = await montar()
    await bloquear(s.b, s.ana.id, sp(16, 9), sp(16, 10), 'Dentista')
    await marcar(s, { startsAt: sp(16, 11), professionalId: s.caio.id })
    const eu = await comoProfissional(s, s.ana.id)
    const dias = await getAgenda(eu, { from: '2026-11-16', to: '2026-11-16' })
    expect(dias[0]?.professionals.map((p) => p.id)).toEqual([s.ana.id])
    expect(dias[0]?.professionals[0]?.blocks[0]?.reason).toBe('Dentista')
    expect((await getAgenda(eu, { from: '2026-11-16', to: '2026-11-16', professionalId: s.ana.id }))[0]?.professionals).toHaveLength(1)
    expect((await domainError(getAgenda(eu, { from: '2026-11-16', to: '2026-11-16', professionalId: s.caio.id }))).code).toBe('forbidden')
  })

  test('profissional sem ficha ligada recebe os dias sem colunas', async () => {
    const s = await montar()
    const semFicha = await comoProfissional(s, null)
    const dias = await getAgenda(semFicha, { from: '2026-11-16', to: '2026-11-17' })
    expect(dias.map((d) => d.professionals)).toEqual([[], []])
  })

  test('o gerente vê as duas colunas na ordem de displayOrder', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.ana.id }, data: { displayOrder: 5 } })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
    expect(dias[0]?.professionals.map((p) => p.name)).toEqual(['Caio', 'Ana'])
  })

  test('o cliente do app não lê a agenda da equipe', async () => {
    const s = await montar()
    const ctx = await comoCliente(s, s.cliente.id)
    expect((await domainError(getAgenda(ctx, { from: '2026-11-16', to: '2026-11-16' }))).code).toBe('forbidden')
  })

  test('o resumo e a agenda não vazam dados de outra conta', async () => {
    const s = await montar()
    const outra = await montar()
    await marcar(s, { startsAt: sp(16, 9) })
    await marcar(outra, { startsAt: sp(16, 9) })
    await bloquear(outra.b, outra.ana.id, sp(16, 12), sp(16, 13))
    await prisma.businessClosure.create({
      data: { businessId: outra.b.id, startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z'), reason: 'Outra' },
    })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
    expect(dias[0]?.closed).toBe(false)
    expect(dias[0]?.professionals.map((p) => p.id)).toEqual([s.ana.id, s.caio.id])
    expect(dias[0]?.professionals.flatMap((p) => p.appointments)).toHaveLength(1)
    expect(dias[0]?.professionals.flatMap((p) => p.blocks)).toHaveLength(0)
    const resumo = await getDaySummary(s.gerente, '2026-11-16')
    expect(resumo.total).toBe(1)
    expect(resumo.workingMinutes).toBe(2 * 480)
  })
})

describe('getAgenda: entrada e custo', () => {
  test('intervalo de 32 dias, invertido ou com data inválida é validation; 31 dias passa', async () => {
    const s = await montar()
    expect((await domainError(getAgenda(s.gerente, { from: '2026-11-01', to: '2026-12-02' }))).code).toBe('validation')
    expect((await domainError(getAgenda(s.gerente, { from: '2026-11-10', to: '2026-11-09' }))).code).toBe('validation')
    expect((await domainError(getAgenda(s.gerente, { from: '2026-02-30', to: '2026-03-01' }))).code).toBe('validation')
    expect(await getAgenda(s.gerente, { from: '2026-11-01', to: '2026-12-01' })).toHaveLength(31)
  })

  test('7 dias com 3 profissionais fazem o mesmo número de consultas que 1 dia com 1 profissional', async () => {
    const pequena = await montar()
    const grande = await montar()
    const extra = await makeProfessional(grande.b.id, { name: 'Duda', displayOrder: 3 })
    await makeWorkingHours(grande.b.id, extra.id, 'TUESDAY', [MANHA])
    await prisma.professional.update({ where: { id: pequena.caio.id }, data: { active: false } })
    for (const s of [pequena, grande]) {
      await marcar(s, { startsAt: sp(16, 9) })
      await bloquear(s.b, s.ana.id, sp(16, 12), sp(16, 13))
    }
    await marcar(grande, { startsAt: sp(18, 9), professionalId: grande.caio.id })
    await marcar(grande, { startsAt: sp(20, 9), professionalId: extra.id })
    await prisma.businessClosure.create({
      data: { businessId: grande.b.id, startDate: new Date('2026-11-19T00:00:00Z'), endDate: new Date('2026-11-19T00:00:00Z') },
    })

    const contar = async (corpo: () => Promise<unknown>): Promise<number> => {
      let consultas = 0
      const original = pg.Client.prototype.query
      pg.Client.prototype.query = function contado(this: pg.Client, ...args: unknown[]) {
        consultas += 1
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      } as typeof original
      try {
        await corpo()
      } finally {
        pg.Client.prototype.query = original
      }
      return consultas
    }

    const umDia = await contar(() => getAgenda(pequena.gerente, { from: '2026-11-16', to: '2026-11-16' }))
    const dias = await getAgenda(grande.gerente, { from: '2026-11-16', to: '2026-11-22' })
    expect(dias).toHaveLength(7)
    expect(dias[0]?.professionals).toHaveLength(3)
    const umaSemana = await contar(() => getAgenda(grande.gerente, { from: '2026-11-16', to: '2026-11-22' }))
    expect(umDia).toBeGreaterThan(0)
    expect(umaSemana).toBe(umDia)
  })
})

describe('getAgenda: profissionais inativos e arquivados', () => {
  test('inativo com agendamento confirmado amanhã aparece, com active false, depois dos ativos', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.ana.id }, data: { active: false } })
    const a = await marcar(s, { startsAt: sp(17, 10) })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    // As colunas valem para o intervalo todo: o inativo aparece em todos os dias consultados.
    expect(dias[0]?.professionals.map((p) => p.id)).toEqual([s.caio.id, s.ana.id])
    expect(dias[0]?.professionals[1]?.appointments).toEqual([])
    expect(dias[1]?.professionals.map((p) => [p.id, p.active, p.archived])).toEqual([
      [s.caio.id, true, false],
      [s.ana.id, false, false],
    ])
    expect(dias[1]?.professionals[1]?.appointments.map((x) => x.id)).toEqual([a.id])
    expect(dias[1]?.professionals[0]?.appointments).toEqual([])
  })

  test('arquivado com atendimento concluído na semana passada aparece naquela consulta, com archived true', async () => {
    const s = await montar()
    const antigo = await makeProfessional(s.b.id, { name: 'Antigo', archivedAt: AGORA, active: false })
    const a = await marcar(s, { startsAt: sp(10, 10), professionalId: antigo.id, status: 'COMPLETED' })
    const passada = await getAgenda(s.gerente, { from: '2026-11-09', to: '2026-11-15' })
    const coluna = passada[1]?.professionals.find((p) => p.id === antigo.id)
    expect(coluna).toMatchObject({ active: false, archived: true })
    expect(coluna?.appointments.map((x) => x.id)).toEqual([a.id])
    expect(passada[0]?.professionals.map((p) => p.id)).toEqual([s.ana.id, s.caio.id, antigo.id])
    expect(passada[0]?.professionals[2]?.appointments).toEqual([])
    const atual = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-22' })
    expect(atual.every((d) => d.professionals.every((p) => p.id !== antigo.id))).toBe(true)
  })

  test('inativo sem agendamento nem bloqueio no intervalo não aparece; com bloqueio aparece', async () => {
    const s = await montar()
    const parado = await makeProfessional(s.b.id, { name: 'Parado', active: false })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    expect(dias.every((d) => d.professionals.every((p) => p.id !== parado.id))).toBe(true)
    await bloquear(s.b, parado.id, sp(17, 9), sp(17, 10), 'Licença')
    const com = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-17' })
    expect(com[0]?.professionals.find((p) => p.id === parado.id)?.blocks).toEqual([])
    expect(com[1]?.professionals.find((p) => p.id === parado.id)?.blocks).toHaveLength(1)
  })

  test('com professionalId a coluna do inativo ou arquivado vem normalmente', async () => {
    const s = await montar()
    const antigo = await makeProfessional(s.b.id, { name: 'Antigo', archivedAt: AGORA, active: false })
    const dias = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', professionalId: antigo.id })
    expect(dias[0]?.professionals.map((p) => [p.id, p.active, p.archived])).toEqual([[antigo.id, false, true]])
  })

  test('dentro do intervalo, a coluna extra não muda o número de consultas', async () => {
    const s = await montar()
    const ex = await makeProfessional(s.b.id, { name: 'Ex', active: false })
    await marcar(s, { startsAt: sp(16, 9), professionalId: ex.id })
    await marcar(s, { startsAt: sp(16, 9) })
    const contar = async (): Promise<number> => {
      let n = 0
      const original = pg.Client.prototype.query
      pg.Client.prototype.query = function contado(this: pg.Client, ...args: unknown[]) {
        n += 1
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      } as typeof original
      try {
        await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16' })
      } finally {
        pg.Client.prototype.query = original
      }
      return n
    }
    const com = await contar()
    await prisma.appointment.deleteMany({ where: { professionalId: ex.id } })
    expect(await contar()).toBeLessThanOrEqual(com)
  })
})

describe('listCustomerAppointments', () => {
  async function historico(s: Montagem) {
    // Relógio: segunda 08:00. Passados: 4 (um cancelado, um concluído); futuros: 3 ativos e 1 cancelado.
    const p3 = await marcar(s, { startsAt: sp(10, 9), status: 'COMPLETED' })
    const p2 = await marcar(s, { startsAt: sp(12, 9), status: 'CANCELED' })
    const p1 = await marcar(s, { startsAt: sp(13, 9), status: 'NO_SHOW' })
    const p0 = await marcar(s, { startsAt: sp(16, 7), status: 'CONFIRMED' })
    const f0 = await marcar(s, { startsAt: sp(16, 8), status: 'CONFIRMED' })
    const f1 = await marcar(s, { startsAt: sp(17, 9), status: 'PENDING', professionalId: s.caio.id })
    const f2 = await marcar(s, { startsAt: sp(20, 9), status: 'CONFIRMED' })
    const fc = await marcar(s, { startsAt: sp(18, 9), status: 'CANCELED' })
    return { passados: [p0.id, p1.id, p2.id, p3.id], futuros: [f0.id, f1.id, f2.id], futuroCancelado: fc.id }
  }

  test('separa próximos e passados em relação ao relógio, cada um na sua ordem', async () => {
    const s = await montar()
    const h = await historico(s)
    const proximos = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(proximos.items.map((x) => x.id)).toEqual(h.futuros)
    expect(proximos.nextCursor).toBeNull()
    const passados = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'past' })
    // O cancelado de 18/11 é "passado" por não estar ativo; a ordem é do mais recente ao mais antigo.
    expect(passados.items.map((x) => x.id)).toEqual([h.futuroCancelado, ...h.passados])
  })

  test('atendimento em andamento é próximo; depois de terminar vai para past; cancelado futuro é past', async () => {
    const s = await montar({ now: sp(16, 10, 10) })
    // Começou às 10:00 (há 10 minutos) e termina às 10:30 (em 20 minutos).
    const andando = await marcar(s, { startsAt: sp(16, 10), durationMin: 30 })
    const cancelado = await marcar(s, { startsAt: sp(18, 9), status: 'CANCELED' })
    const proximos = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(proximos.items.map((x) => x.id)).toEqual([andando.id])
    expect((await getNextAppointment(s.gerente, s.cliente.id))?.id).toBe(andando.id)
    const passados = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'past' })
    expect(passados.items.map((x) => x.id)).toEqual([cancelado.id])

    const depois = await makeCtx(s.b, { now: sp(16, 10, 30) })
    expect((await listCustomerAppointments(depois, { customerId: s.cliente.id, scope: 'upcoming' })).items).toEqual([])
    expect(await getNextAppointment(depois, s.cliente.id)).toBeNull()
    const passadosDepois = await listCustomerAppointments(depois, { customerId: s.cliente.id, scope: 'past' })
    expect(passadosDepois.items.map((x) => x.id)).toEqual([cancelado.id, andando.id])
  })

  test('cursor com epoch fora do limite de Date é validation', async () => {
    const s = await montar()
    const cursor = Buffer.from(JSON.stringify([9e15, '00000000-0000-4000-8000-000000000000'])).toString('base64url')
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming', cursor }))).code).toBe('validation')
  })

  test('um agendamento que começa exatamente agora é próximo', async () => {
    const s = await montar()
    const agora = await marcar(s, { startsAt: AGORA })
    const proximos = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(proximos.items.map((x) => x.id)).toEqual([agora.id])
    expect((await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'past' })).items).toEqual([])
  })

  test('pagina sem repetir nem perder, inclusive com horários iguais', async () => {
    const s = await montar()
    const criados = []
    // Dois no mesmo horário (profissionais diferentes) para provar o desempate por id.
    criados.push(await marcar(s, { startsAt: sp(17, 9) }))
    criados.push(await marcar(s, { startsAt: sp(17, 9), professionalId: s.caio.id }))
    for (let i = 2; i < 5; i += 1) criados.push(await marcar(s, { startsAt: sp(17, 9 + i) }))
    for (const scope of ['upcoming', 'past'] as const) {
      const relogio = scope === 'upcoming' ? s.gerente : await makeCtx(s.b, { now: sp(30, 12) })
      const vistos: string[] = []
      let cursor: string | undefined
      let paginas = 0
      do {
        const pagina = await listCustomerAppointments(relogio, { customerId: s.cliente.id, scope, limit: 2, ...(cursor ? { cursor } : {}) })
        vistos.push(...pagina.items.map((x) => x.id))
        cursor = pagina.nextCursor ?? undefined
        paginas += 1
      } while (cursor && paginas < 10)
      expect(paginas).toBe(3)
      expect(new Set(vistos).size).toBe(5)
      expect(vistos.slice().sort()).toEqual(criados.map((x) => x.id).sort())
    }
  })

  test('limite padrão 20, máximo 50, e cursor inválido é validation', async () => {
    const s = await montar()
    for (let i = 0; i < 21; i += 1) await marcar(s, { startsAt: sp(17, 9, i * 5), durationMin: 5 })
    const padrao = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(padrao.items).toHaveLength(20)
    expect(padrao.nextCursor).not.toBeNull()
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming', limit: 51 }))).code).toBe('validation')
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming', limit: 0 }))).code).toBe('validation')
    for (const cursor of ['lixo', Buffer.from('[1,"x"]').toString('base64url'), Buffer.from('{}').toString('base64url')]) {
      expect((await domainError(listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming', cursor }))).code).toBe('validation')
    }
  })

  test('a equipe precisa informar o cliente; cliente de outra conta ou inexistente é not_found', async () => {
    const s = await montar()
    const outra = await montar()
    expect((await domainError(listCustomerAppointments(s.gerente, { scope: 'upcoming' }))).code).toBe('validation')
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: outra.cliente.id, scope: 'upcoming' }))).code).toBe('not_found')
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: 'abc', scope: 'upcoming' }))).code).toBe('not_found')
    expect((await domainError(listCustomerAppointments(s.gerente, { customerId: '00000000-0000-4000-8000-000000000000', scope: 'upcoming' }))).code).toBe('not_found')
  })

  test('o papel PROFESSIONAL vê todos os agendamentos do cliente, inclusive de colegas; sem permissão de ver clientes, forbidden', async () => {
    const s = await montar()
    const h = await historico(s)
    const eu = await comoProfissional(s, s.ana.id)
    const lista = await listCustomerAppointments(eu, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(lista.items.map((x) => x.id)).toEqual(h.futuros)
    const sistema = await makeCtx(s.b, { actor: { kind: 'system' }, now: s.now })
    expect((await domainError(listCustomerAppointments(sistema, { customerId: s.cliente.id, scope: 'upcoming' }))).code).toBe('forbidden')
  })

  test('o cliente do app lista os próprios sem informar o id, sem comissão nem observações; o id de outro é forbidden', async () => {
    const s = await montar()
    const h = await historico(s)
    await prisma.appointment.update({ where: { id: h.futuros[0] ?? '' }, data: { commissionCents: 900, notes: 'interna' } })
    const eu = await comoCliente(s, s.cliente.id)
    const proprios = await listCustomerAppointments(eu, { scope: 'upcoming' })
    expect(proprios.items.map((x) => x.id)).toEqual(h.futuros)
    expect(proprios.items[0]).not.toHaveProperty('commissionCents')
    expect(proprios.items[0]).not.toHaveProperty('notes')
    expect((await listCustomerAppointments(eu, { customerId: s.cliente.id, scope: 'upcoming' })).items).toHaveLength(3)
    const colega = await makeCustomer(s.b.id)
    await marcar(s, { startsAt: sp(18, 9), customerId: colega.id })
    expect((await domainError(listCustomerAppointments(eu, { customerId: colega.id, scope: 'upcoming' }))).code).toBe('forbidden')
    expect((await domainError(getNextAppointment(eu, colega.id))).code).toBe('forbidden')
  })

  test('a equipe vê comissão e observações', async () => {
    const s = await montar()
    const a = await marcar(s, { startsAt: sp(17, 9) })
    await prisma.appointment.update({ where: { id: a.id }, data: { commissionCents: 900, notes: 'interna' } })
    const [item] = (await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })).items
    expect(item?.commissionCents).toBe(900)
    expect(item?.notes).toBe('interna')
  })

  test('não traz agendamentos de outro cliente nem de outra conta', async () => {
    const s = await montar()
    const outra = await montar()
    const mine = await marcar(s, { startsAt: sp(17, 9) })
    await marcar(s, { startsAt: sp(17, 10), customerId: (await makeCustomer(s.b.id)).id })
    await marcar(outra, { startsAt: sp(17, 9) })
    const lista = await listCustomerAppointments(s.gerente, { customerId: s.cliente.id, scope: 'upcoming' })
    expect(lista.items.map((x) => x.id)).toEqual([mine.id])
    const doOutro = await comoCliente(outra, outra.cliente.id)
    expect((await listCustomerAppointments(doOutro, { scope: 'upcoming' })).items.map((x) => x.customer.id)).toEqual([outra.cliente.id])
  })
})

describe('getNextAppointment', () => {
  test('devolve o mais próximo ativo; ignora cancelados, concluídos, faltas e passados; null quando não há', async () => {
    const s = await montar()
    expect(await getNextAppointment(s.gerente, s.cliente.id)).toBeNull()
    await marcar(s, { startsAt: sp(16, 7) })
    await marcar(s, { startsAt: sp(16, 9), status: 'CANCELED' })
    await marcar(s, { startsAt: sp(16, 9), status: 'COMPLETED' })
    await marcar(s, { startsAt: sp(16, 9), status: 'NO_SHOW' })
    expect(await getNextAppointment(s.gerente, s.cliente.id)).toBeNull()
    await marcar(s, { startsAt: sp(20, 9) })
    const perto = await marcar(s, { startsAt: sp(17, 9), status: 'PENDING' })
    const proximo = await getNextAppointment(s.gerente, s.cliente.id)
    expect(proximo?.id).toBe(perto.id)
    expect(proximo?.items[0]?.name).toBe('Banho')
  })

  test('o cliente consulta o próprio sem informar o id; a equipe precisa informar', async () => {
    const s = await montar()
    const a = await marcar(s, { startsAt: sp(17, 9) })
    const eu = await comoCliente(s, s.cliente.id)
    expect((await getNextAppointment(eu))?.id).toBe(a.id)
    expect((await domainError(getNextAppointment(s.gerente))).code).toBe('validation')
    const outra = await montar()
    expect((await domainError(getNextAppointment(s.gerente, outra.cliente.id))).code).toBe('not_found')
  })
})

describe('getDaySummary', () => {
  async function dia(s: Montagem) {
    await marcar(s, { startsAt: sp(16, 9), status: 'CONFIRMED' })
    await marcar(s, { startsAt: sp(16, 10), status: 'CONFIRMED', serviceId: s.tosa.id, professionalId: s.caio.id })
    await marcar(s, { startsAt: sp(16, 14), status: 'COMPLETED', professionalId: s.caio.id })
    await marcar(s, { startsAt: sp(16, 15), status: 'CANCELED' })
    // De outro dia: não conta.
    await marcar(s, { startsAt: sp(17, 9), status: 'CONFIRMED' })
  }

  test('2 confirmados (60 e 30 min), 1 concluído de 60 min e R$ 80,00 e 1 cancelado', async () => {
    const s = await montar()
    await dia(s)
    const r = await getDaySummary(s.gerente, '2026-11-16')
    expect(r).toEqual({
      total: 4,
      byStatus: { PENDING: 0, CONFIRMED: 2, COMPLETED: 1, CANCELED: 1, NO_SHOW: 0 },
      bookedMinutes: 150,
      workingMinutes: 2 * (180 + 300),
      revenueCents: 8000,
      occupancy: 0.1563,
    })
  })

  test('filtra por profissional; pendentes e faltas entram em total e byStatus, e a falta não entra em bookedMinutes', async () => {
    const s = await montar()
    await dia(s)
    await marcar(s, { startsAt: sp(16, 16), status: 'PENDING', professionalId: s.caio.id })
    await marcar(s, { startsAt: sp(16, 17), status: 'NO_SHOW', professionalId: s.caio.id })
    const r = await getDaySummary(s.gerente, '2026-11-16', s.caio.id)
    expect(r).toEqual({
      total: 4,
      byStatus: { PENDING: 1, CONFIRMED: 1, COMPLETED: 1, CANCELED: 0, NO_SHOW: 1 },
      bookedMinutes: 30 + 60 + 60, // confirmado 30, concluído 60, pendente 60
      workingMinutes: 480,
      revenueCents: 8000,
      occupancy: 0.3125,
    })
  })

  test('o dia segue o fuso da conta (Manaus)', async () => {
    const s = await montar({ timezone: MANAUS })
    await marcar(s, { startsAt: new Date('2026-11-17T02:30:00Z') })
    await marcar(s, { startsAt: new Date('2026-11-17T04:00:00Z') })
    expect((await getDaySummary(s.gerente, '2026-11-16')).total).toBe(1)
    expect((await getDaySummary(s.gerente, '2026-11-17')).total).toBe(1)
  })

  test('dia fechado: workingMinutes 0, mas os agendamentos existentes contam', async () => {
    const s = await montar()
    await dia(s)
    await prisma.businessClosure.create({
      data: { businessId: s.b.id, startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-16T00:00:00Z') },
    })
    const r = await getDaySummary(s.gerente, '2026-11-16')
    expect(r.workingMinutes).toBe(0)
    expect(r.occupancy).toBeNull()
    expect(r.total).toBe(4)
  })

  test('com um inativo que tem agendamento, o resumo bate com a soma das colunas da agenda', async () => {
    const s = await montar()
    await dia(s)
    const ex = await makeProfessional(s.b.id, { name: 'Ex', active: false })
    await makeWorkingHours(s.b.id, ex.id, 'MONDAY', [MANHA])
    await makeProfessional(s.b.id, { name: 'Parado', active: false })
    await marcar(s, { startsAt: sp(16, 9), professionalId: ex.id, status: 'COMPLETED' })
    const r = await getDaySummary(s.gerente, '2026-11-16')
    const [agenda] = await getAgenda(s.gerente, { from: '2026-11-16', to: '2026-11-16', includeCanceled: true })
    const colunas = agenda?.professionals ?? []
    expect(colunas.map((p) => p.id)).toContain(ex.id)
    const itens = colunas.flatMap((p) => p.appointments)
    expect(r.total).toBe(itens.length)
    expect(r.bookedMinutes).toBe(itens.filter((a) => a.status !== 'CANCELED').reduce((n, a) => n + a.totalDurationMin, 0))
    expect(r.workingMinutes).toBe(colunas.reduce((n, p) => n + p.workingRanges.reduce((m, w) => m + w.endMin - w.startMin, 0), 0))
    expect(r.workingMinutes).toBe(2 * 480 + 180)
    expect(r.revenueCents).toBe(16000)
    expect(r.occupancy).toBe(Math.round((r.bookedMinutes / r.workingMinutes) * 10000) / 10000)
  })

  test('occupancy fica limitada a 1 e é null sem expediente', async () => {
    const s = await montar()
    const so = await makeProfessional(s.b.id, { name: 'Só', serviceIds: [s.banho.id] })
    await makeWorkingHours(s.b.id, so.id, 'TUESDAY', [{ startMin: 540, endMin: 600 }])
    await prisma.professional.update({ where: { id: s.ana.id }, data: { active: false } })
    await prisma.professional.update({ where: { id: s.caio.id }, data: { active: false } })
    await marcar(s, { startsAt: sp(17, 9), professionalId: so.id, durationMin: 60 })
    await marcar(s, { startsAt: sp(17, 10), professionalId: so.id, durationMin: 60 })
    const cheio = await getDaySummary(s.gerente, '2026-11-17')
    expect(cheio.bookedMinutes).toBe(120)
    expect(cheio.workingMinutes).toBe(60)
    expect(cheio.occupancy).toBe(1)
    expect((await getDaySummary(s.gerente, '2026-11-18')).occupancy).toBeNull()
  })

  test('dia vazio devolve tudo zerado, com as cinco chaves', async () => {
    const s = await montar()
    expect(await getDaySummary(s.gerente, '2026-11-18')).toEqual({
      total: 0,
      byStatus: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, NO_SHOW: 0 },
      bookedMinutes: 0,
      workingMinutes: 0,
      revenueCents: 0,
      occupancy: null,
    })
  })

  test('o profissional recebe só o resumo da própria ficha; o de um colega é forbidden; sem ficha, zerado', async () => {
    const s = await montar()
    await dia(s)
    const eu = await comoProfissional(s, s.ana.id)
    const meu = await getDaySummary(eu, '2026-11-16')
    expect(meu.total).toBe(2)
    expect(meu.bookedMinutes).toBe(60)
    expect(meu.workingMinutes).toBe(480)
    expect(meu.occupancy).toBe(0.125)
    expect((await getDaySummary(eu, '2026-11-16', s.ana.id)).total).toBe(2)
    expect((await domainError(getDaySummary(eu, '2026-11-16', s.caio.id))).code).toBe('forbidden')
    const semFicha = await comoProfissional(s, null)
    expect(await getDaySummary(semFicha, '2026-11-16')).toEqual({
      total: 0,
      byStatus: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, NO_SHOW: 0 },
      bookedMinutes: 0,
      workingMinutes: 0,
      revenueCents: 0,
      occupancy: null,
    })
  })

  test('o cliente é forbidden; data inválida é validation; profissional de outra conta é not_found', async () => {
    const s = await montar()
    const outra = await montar()
    const eu = await comoCliente(s, s.cliente.id)
    expect((await domainError(getDaySummary(eu, '2026-11-16'))).code).toBe('forbidden')
    expect((await domainError(getDaySummary(s.gerente, '16/11/2026'))).code).toBe('validation')
    expect((await domainError(getDaySummary(s.gerente, '2026-11-16', outra.ana.id))).code).toBe('not_found')
  })
})
