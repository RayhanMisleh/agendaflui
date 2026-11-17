import { prisma } from '@/server/db/client'
import { getAgenda, getDaySummary } from '@/server/domain/scheduling/agenda'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCustomer,
  makeProfessional,
  makeService,
  makeWorkingHours,
} from '../setup/factories'

beforeEach(resetDb)

const SP = 'America/Sao_Paulo'
const MANHA = { startMin: 540, endMin: 720 }
const TARDE = { startMin: 780, endMin: 1080 }
const AGORA = new Date('2026-11-16T11:00:00Z')
/** Instante de uma hora local de São Paulo (UTC-3) em 2026-11-<dia>. */
const sp = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 3, m))

async function montar() {
  const b = await makeBusiness({ timezone: SP })
  const servico = await makeService(b.id, { durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [servico.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', displayOrder: 2, serviceIds: [servico.id] })
  for (const p of [ana, caio]) await makeWorkingHours(b.id, p.id, 'MONDAY', [MANHA, TARDE])
  const ctx = await ctxWithRole(b, 'MANAGER', { now: AGORA })
  const cliente = await makeCustomer(b.id)
  return { b, servico, ana, caio, ctx, cliente }
}

function bloquear(businessId: string, professionalId: string, startsAt: Date, endsAt: Date) {
  return prisma.timeBlock.create({ data: { businessId, professionalId, startsAt, endsAt, createdByType: 'SYSTEM' } })
}

describe('teto da agenda', () => {
  test('31 dias passam e 32 dias dão erro de validação claro', async () => {
    const s = await montar()
    await expect(getAgenda(s.ctx, { from: '2026-11-01', to: '2026-12-01' })).resolves.toHaveLength(31)
    const erro = await domainError(getAgenda(s.ctx, { from: '2026-11-01', to: '2026-12-02' }))
    expect(erro.code).toBe('validation')
    expect(erro.message).toContain('31 dias')
  })

  test('mais de 5.000 agendamentos no período dão erro claro, em vez de uma resposta gigante', async () => {
    const s = await montar()
    const inicio = sp(2, 0)
    await prisma.appointment.createMany({
      data: Array.from({ length: 5001 }, (_, i) => ({
        businessId: s.b.id,
        customerId: s.cliente.id,
        professionalId: s.ana.id,
        startsAt: addMinutes(inicio, i),
        endsAt: addMinutes(inicio, i + 1),
        status: 'COMPLETED' as const,
        source: 'PANEL' as const,
        totalCents: 1000,
        totalDurationMin: 1,
        createdByType: 'SYSTEM' as const,
      })),
    })
    const erro = await domainError(getAgenda(s.ctx, { from: '2026-11-02', to: '2026-11-08' }))
    expect(erro.code).toBe('validation')
    expect(erro.message).toContain('menos dias')
  })
})

describe('resumo do dia', () => {
  const SEGUNDA = '2026-11-16'

  test('sem bloqueio, o expediente de dois profissionais soma 960 minutos', async () => {
    const s = await montar()
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(960)
  })

  test('um bloqueio de 2 horas dentro do expediente desconta 120 minutos', async () => {
    const s = await montar()
    await bloquear(s.b.id, s.ana.id, sp(16, 10), sp(16, 12))
    const resumo = await getDaySummary(s.ctx, SEGUNDA)
    expect(resumo.workingMinutes).toBe(840)
  })

  test('bloqueio no intervalo do almoço, fora do expediente, não desconta nada', async () => {
    const s = await montar()
    await bloquear(s.b.id, s.ana.id, sp(16, 12), sp(16, 13))
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(960)
  })

  test('bloqueios sobrepostos do mesmo profissional descontam o tempo uma vez só', async () => {
    const s = await montar()
    await bloquear(s.b.id, s.ana.id, sp(16, 10), sp(16, 11))
    await bloquear(s.b.id, s.ana.id, sp(16, 10, 30), sp(16, 11, 30))
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(960 - 90)
  })

  test('bloqueio que começa no dia anterior e termina no dia só desconta a parte do dia', async () => {
    const s = await montar()
    await bloquear(s.b.id, s.ana.id, sp(15, 20), sp(16, 10))
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(960 - 60)
  })

  test('profissional inativo com atendimento no dia aparece na agenda e no resumo', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.caio.id }, data: { active: false } })
    const antes = await getDaySummary(s.ctx, SEGUNDA)
    expect(antes.workingMinutes).toBe(480)
    await makeAppointment(s.b.id, {
      customerId: s.cliente.id,
      professionalId: s.caio.id,
      serviceId: s.servico.id,
      startsAt: sp(16, 9),
    })
    const [dia] = await getAgenda(s.ctx, { from: SEGUNDA, to: SEGUNDA })
    expect(dia?.professionals.map((p) => p.name)).toEqual(['Ana', 'Caio'])
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(960)
  })

  test('profissional inativo só com bloqueio no dia aparece na agenda e o resumo usa o mesmo conjunto', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.caio.id }, data: { active: false } })
    await bloquear(s.b.id, s.caio.id, sp(16, 9), sp(16, 10))
    const [dia] = await getAgenda(s.ctx, { from: SEGUNDA, to: SEGUNDA })
    expect(dia?.professionals.map((p) => p.name)).toEqual(['Ana', 'Caio'])
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(480 + 480 - 60)
  })

  test('profissional inativo só com agendamento cancelado fica fora da agenda e do resumo', async () => {
    const s = await montar()
    await prisma.professional.update({ where: { id: s.caio.id }, data: { active: false } })
    await makeAppointment(s.b.id, {
      customerId: s.cliente.id,
      professionalId: s.caio.id,
      serviceId: s.servico.id,
      startsAt: sp(16, 9),
      status: 'CANCELED',
    })
    const [dia] = await getAgenda(s.ctx, { from: SEGUNDA, to: SEGUNDA })
    expect(dia?.professionals.map((p) => p.name)).toEqual(['Ana'])
    expect((await getDaySummary(s.ctx, SEGUNDA)).workingMinutes).toBe(480)
  })
})
