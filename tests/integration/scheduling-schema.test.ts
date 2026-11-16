import { beforeEach, describe, expect, test } from 'vitest'
import type { Business } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness } from '../setup/factories'

let n = 0
const un = (): string => `${++n}`

const customer = (businessId: string, o: Record<string, unknown> = {}) =>
  prisma.customer.create({ data: { businessId, name: `Cliente ${un()}`, origin: 'PANEL', ...o } })
const professional = (businessId: string) =>
  prisma.professional.create({ data: { businessId, name: `Prof ${un()}` } })
const service = (businessId: string, o: Record<string, unknown> = {}) =>
  prisma.service.create({ data: { businessId, name: `Serv ${un()}`, priceCents: 5000, durationMin: 30, ...o } })

const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 10, 20, h, m))

async function agendar(
  businessId: string,
  customerId: string,
  professionalId: string,
  de: Date,
  ate: Date,
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW' = 'CONFIRMED',
) {
  return prisma.appointment.create({
    data: {
      businessId, customerId, professionalId, startsAt: de, endsAt: ate, status,
      source: 'PANEL', totalCents: 5000, totalDurationMin: 30, createdByType: 'SYSTEM',
    },
  })
}

/** Prisma 7 + adaptador pg: código P2039; o erro do Postgres vem em meta.driverAdapterError.cause (code 23P01). */
function causaDoDriver(e: unknown): { code?: string; message?: string } {
  const meta = (e as { meta?: { driverAdapterError?: { cause?: { code?: string; message?: string } } } }).meta
  return meta?.driverAdapterError?.cause ?? {}
}

let a: Business, b: Business
beforeEach(async () => {
  await resetDb()
  ;[a, b] = [await makeBusiness(), await makeBusiness()]
})

describe('sobreposição de agendamentos', () => {
  test('dois agendamentos ativos sobrepostos do mesmo profissional: o segundo é recusado por appointments_no_overlap', async () => {
    const [c, p] = [await customer(a.id), await professional(a.id)]
    await agendar(a.id, c.id, p.id, hora(9), hora(10))
    const erro = await agendar(a.id, c.id, p.id, hora(9, 30), hora(10, 30)).then(
      () => null,
      (e: unknown) => e,
    )
    expect(erro).not.toBeNull()
    expect((erro as { code?: string }).code).toBe('P2039')
    const causa = causaDoDriver(erro)
    expect(causa.code).toBe('23P01')
    expect(causa.message).toContain('"appointments_no_overlap"')
  })

  test('intervalos que só se encostam são aceitos', async () => {
    const [c, p] = [await customer(a.id), await professional(a.id)]
    await agendar(a.id, c.id, p.id, hora(9), hora(10))
    await expect(agendar(a.id, c.id, p.id, hora(10), hora(11))).resolves.toBeDefined()
  })

  test('sobreposto a um agendamento cancelado é aceito', async () => {
    const [c, p] = [await customer(a.id), await professional(a.id)]
    await agendar(a.id, c.id, p.id, hora(9), hora(10), 'CANCELED')
    await expect(agendar(a.id, c.id, p.id, hora(9), hora(10))).resolves.toBeDefined()
  })

  test('mesmo intervalo com outro profissional é aceito', async () => {
    const c = await customer(a.id)
    const [p1, p2] = [await professional(a.id), await professional(a.id)]
    await agendar(a.id, c.id, p1.id, hora(9), hora(10))
    await expect(agendar(a.id, c.id, p2.id, hora(9), hora(10))).resolves.toBeDefined()
  })
})

describe('isolamento por FK composta', () => {
  test('agendamento com cliente de outra conta é recusado', async () => {
    const cb = await customer(b.id)
    const p = await professional(a.id)
    await expect(agendar(a.id, cb.id, p.id, hora(9), hora(10))).rejects.toThrow(/same_business_fkey/)
  })

  test('agendamento com profissional de outra conta é recusado', async () => {
    const c = await customer(a.id)
    const pb = await professional(b.id)
    await expect(agendar(a.id, c.id, pb.id, hora(9), hora(10))).rejects.toThrow(/same_business_fkey/)
  })

  test('item de agendamento com serviço de outra conta é recusado', async () => {
    const [c, p] = [await customer(a.id), await professional(a.id)]
    const ap = await agendar(a.id, c.id, p.id, hora(9), hora(10))
    const sb = await service(b.id)
    await expect(
      prisma.appointmentItem.create({
        data: { businessId: a.id, appointmentId: ap.id, serviceId: sb.id, name: 'x', priceCents: 1, durationMin: 5, rewardPoints: 0, position: 0 },
      }),
    ).rejects.toThrow(/same_business_fkey/)
  })

  test('cliente com avatar de upload de outra conta é recusado', async () => {
    const up = await prisma.upload.create({
      data: { businessId: b.id, path: `b/${un()}.png`, mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, createdByType: 'SYSTEM' },
    })
    await expect(customer(a.id, { avatarUploadId: up.id })).rejects.toThrow(/same_business_fkey/)
  })

  test('apagar o upload do avatar zera só a coluna do avatar', async () => {
    const up = await prisma.upload.create({
      data: { businessId: a.id, path: `a/${un()}.png`, mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, createdByType: 'SYSTEM' },
    })
    const c = await customer(a.id, { avatarUploadId: up.id })
    await prisma.upload.delete({ where: { id: up.id } })
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois.avatarUploadId).toBeNull()
    expect(depois.businessId).toBe(a.id)
  })

  test('cliente e profissional com agendamento não podem ser apagados; itens saem junto com o agendamento', async () => {
    const [c, p] = [await customer(a.id), await professional(a.id)]
    const s = await service(a.id)
    const ap = await agendar(a.id, c.id, p.id, hora(9), hora(10))
    await prisma.appointmentItem.create({
      data: { businessId: a.id, appointmentId: ap.id, serviceId: s.id, name: 'x', priceCents: 1, durationMin: 5, rewardPoints: 0, position: 0 },
    })
    await expect(prisma.customer.delete({ where: { id: c.id } })).rejects.toThrow()
    await expect(prisma.professional.delete({ where: { id: p.id } })).rejects.toThrow()
    await expect(prisma.service.delete({ where: { id: s.id } })).rejects.toThrow()
    await prisma.appointment.delete({ where: { id: ap.id } })
    expect(await prisma.appointmentItem.count({ where: { appointmentId: ap.id } })).toBe(0)
  })
})

describe('restrições de valores', () => {
  test('working_hours com início igual ao fim é recusado', async () => {
    const p = await professional(a.id)
    await expect(
      prisma.workingHours.create({ data: { businessId: a.id, professionalId: p.id, weekday: 'MONDAY', startMin: 600, endMin: 600 } }),
    ).rejects.toThrow()
    await expect(
      prisma.workingHours.create({ data: { businessId: a.id, professionalId: p.id, weekday: 'MONDAY', startMin: 540, endMin: 1080 } }),
    ).resolves.toBeDefined()
  })

  test('duração de serviço fora do passo de 5 minutos é recusada', async () => {
    await expect(service(a.id, { durationMin: 7 })).rejects.toThrow()
    await expect(service(a.id, { durationMin: 0 })).rejects.toThrow()
    await expect(service(a.id, { durationMin: 605 })).rejects.toThrow()
    await expect(service(a.id, { durationMin: 45 })).resolves.toBeDefined()
  })

  test('telefone fora do formato é recusado', async () => {
    await expect(customer(a.id, { phone: '119' })).rejects.toThrow()
    await expect(customer(a.id, { phone: '11999998888' })).resolves.toBeDefined()
  })

  test('e-mail de cliente precisa estar normalizado', async () => {
    await expect(customer(a.id, { email: 'Maria@x.com' })).rejects.toThrow()
  })

  test('e-mail de cliente é único na conta, não entre contas; sem e-mail pode repetir', async () => {
    await customer(a.id, { email: 'maria@x.com' })
    await expect(customer(a.id, { email: 'maria@x.com' })).rejects.toThrow()
    await expect(customer(b.id, { email: 'maria@x.com' })).resolves.toBeDefined()
    await expect(customer(a.id)).resolves.toBeDefined()
    await expect(customer(a.id)).resolves.toBeDefined()
  })

  test('comissão fora de 0 a 10000 é recusada', async () => {
    await expect(prisma.professional.create({ data: { businessId: a.id, name: 'x', commissionBps: 10001 } })).rejects.toThrow()
  })

  test('bloqueio e fechamento com fim antes do início são recusados', async () => {
    const p = await professional(a.id)
    await expect(
      prisma.timeBlock.create({ data: { businessId: a.id, professionalId: p.id, startsAt: hora(10), endsAt: hora(9), createdByType: 'SYSTEM' } }),
    ).rejects.toThrow()
    await expect(
      prisma.businessClosure.create({ data: { businessId: a.id, startDate: new Date('2026-12-25'), endDate: new Date('2026-12-24') } }),
    ).rejects.toThrow()
  })

  test('um profissional por vínculo de equipe na conta', async () => {
    const u = await prisma.user.create({ data: { name: 'U', email: `u${un()}@x.com` } })
    const m = await prisma.membership.create({ data: { businessId: a.id, userId: u.id, role: 'PROFESSIONAL' } })
    await prisma.professional.create({ data: { businessId: a.id, name: 'P1', membershipId: m.id } })
    await expect(prisma.professional.create({ data: { businessId: a.id, name: 'P2', membershipId: m.id } })).rejects.toThrow()
    await expect(prisma.professional.create({ data: { businessId: a.id, name: 'P3' } })).resolves.toBeDefined()
    await expect(prisma.professional.create({ data: { businessId: a.id, name: 'P4' } })).resolves.toBeDefined()
  })
})

describe('fila de avisos', () => {
  const base = (businessId: string, o: Record<string, unknown>) =>
    prisma.notification.create({
      data: { businessId, kind: 'APPOINTMENT_CONFIRMED', channel: 'EMAIL', scheduledFor: hora(8), dedupeKey: `k${un()}`, ...o },
    })

  test('sem destinatário e com dois destinatários são recusados', async () => {
    const c = await customer(a.id)
    const u = await prisma.user.create({ data: { name: 'U', email: `u${un()}@x.com` } })
    const m = await prisma.membership.create({ data: { businessId: a.id, userId: u.id, role: 'OWNER' } })
    await expect(base(a.id, {})).rejects.toThrow()
    await expect(base(a.id, { customerId: c.id, membershipId: m.id })).rejects.toThrow()
    await expect(base(a.id, { customerId: c.id })).resolves.toBeDefined()
    await expect(base(a.id, { membershipId: m.id })).resolves.toBeDefined()
  })

  test('mesma dedupe_key na mesma conta é recusada; em outra conta é aceita', async () => {
    const [ca, cb] = [await customer(a.id), await customer(b.id)]
    await base(a.id, { customerId: ca.id, dedupeKey: 'igual' })
    await expect(base(a.id, { customerId: ca.id, dedupeKey: 'igual' })).rejects.toThrow()
    await expect(base(b.id, { customerId: cb.id, dedupeKey: 'igual' })).resolves.toBeDefined()
  })

  test('aviso com cliente de outra conta é recusado', async () => {
    const cb = await customer(b.id)
    await expect(base(a.id, { customerId: cb.id })).rejects.toThrow(/same_business_fkey/)
  })
})
