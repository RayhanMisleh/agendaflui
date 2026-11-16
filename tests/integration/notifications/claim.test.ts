import { prisma } from '@/server/db/client'
import { claimDue } from '@/server/notifications/claim'
import { addMinutes } from '@/server/time'
import { resetDb } from '../../setup/db'
import { makeBusiness, makeCustomer } from '../../setup/factories'

beforeEach(resetDb)

const AGORA = new Date('2026-11-16T16:00:00Z')

async function fila(n: number, o: { scheduledFor?: (i: number) => Date } = {}) {
  const b = await makeBusiness()
  const c = await makeCustomer(b.id, { email: 'c@exemplo.test' })
  await prisma.notification.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      businessId: b.id,
      kind: 'APPOINTMENT_CONFIRMED' as const,
      channel: 'EMAIL' as const,
      customerId: c.id,
      scheduledFor: o.scheduledFor?.(i) ?? addMinutes(AGORA, -i - 1),
      dedupeKey: `k${i}`,
    })),
  })
  return b
}

describe('claimDue', () => {
  test('reserva por 2 minutos, em ordem de scheduled_for, até o limite, e devolve conta e id da reserva', async () => {
    const b = await fila(5)
    const r = await claimDue(AGORA, 3)
    expect(r).toHaveLength(3)
    expect(r.every((x) => x.businessId === b.id)).toBe(true)
    const linhas = await prisma.notification.findMany({ where: { id: { in: r.map((x) => x.id) } }, orderBy: { scheduledFor: 'asc' } })
    expect(r.map((x) => x.id)).toEqual(linhas.map((l) => l.id))
    // as três mais antigas (i = 4, 3, 2)
    expect(linhas.map((l) => l.dedupeKey)).toEqual(['k4', 'k3', 'k2'])
    for (const l of linhas) {
      expect(l.lockedUntil?.getTime()).toBe(addMinutes(AGORA, 2).getTime())
      expect(l.status).toBe('PENDING')
    }
    expect(new Set(r.map((x) => x.lockedBy)).size).toBe(1)
    expect(await prisma.notification.count({ where: { lockedBy: r[0]!.lockedBy } })).toBe(3)
  })

  test('não reserva o que é do futuro nem o que não está pendente', async () => {
    const b = await fila(1, { scheduledFor: () => addMinutes(AGORA, 1) })
    const c = await makeCustomer(b.id)
    await prisma.notification.createMany({
      data: (['SENT', 'FAILED', 'CANCELED', 'SKIPPED'] as const).map((status) => ({
        businessId: b.id, kind: 'APPOINTMENT_CONFIRMED' as const, channel: 'EMAIL' as const, customerId: c.id,
        scheduledFor: addMinutes(AGORA, -5), status, dedupeKey: `s-${status}`,
      })),
    })
    expect(await claimDue(AGORA, 50)).toEqual([])
  })

  test('linha com reserva no futuro não é reservada; reserva vencida é', async () => {
    await fila(2)
    const [a, b] = await prisma.notification.findMany({ orderBy: { dedupeKey: 'asc' } })
    await prisma.notification.update({ where: { id: a!.id }, data: { lockedUntil: addMinutes(AGORA, 1), lockedBy: 'outro' } })
    await prisma.notification.update({ where: { id: b!.id }, data: { lockedUntil: addMinutes(AGORA, -1), lockedBy: 'antigo' } })
    const r = await claimDue(AGORA, 50)
    expect(r.map((x) => x.id)).toEqual([b!.id])
    const depois = await prisma.notification.findUniqueOrThrow({ where: { id: b!.id } })
    expect(depois.lockedBy).toBe(r[0]!.lockedBy)
    expect(depois.lockedBy).not.toBe('antigo')
  })

  test('duas reservas simultâneas nunca entregam a mesma linha às duas', async () => {
    await fila(40)
    const [x, y, z] = await Promise.all([claimDue(AGORA, 20), claimDue(AGORA, 20), claimDue(AGORA, 20)])
    const ids = [...x, ...y, ...z].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(40)
    expect(new Set([x[0]?.lockedBy, y[0]?.lockedBy, z[0]?.lockedBy].filter(Boolean)).size).toBe([x, y, z].filter((l) => l.length > 0).length)
  })

  test('rodar de novo logo depois não devolve o que ainda está reservado', async () => {
    await fila(3)
    expect(await claimDue(AGORA, 50)).toHaveLength(3)
    expect(await claimDue(addMinutes(AGORA, 1), 50)).toEqual([])
    expect(await claimDue(addMinutes(AGORA, 3), 50)).toHaveLength(3)
  })
})
