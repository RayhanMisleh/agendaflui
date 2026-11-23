import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { RETENTION_DAYS, runRetention } from '@/server/db/retention'
import { addMinutes, fromIsoInstant } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer } from '../setup/factories'

const NOW = fromIsoInstant('2026-11-20T12:00:00.000Z')
const diasAtras = (n: number) => addMinutes(NOW, -n * 24 * 60)

beforeEach(resetDb)

async function aviso(businessId: string, customerId: string, status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELED', idadeEmDias: number) {
  return prisma.notification.create({
    data: {
      businessId,
      customerId,
      kind: 'APPOINTMENT_CONFIRMED',
      channel: 'EMAIL',
      scheduledFor: diasAtras(idadeEmDias),
      status,
      dedupeKey: randomUUID(),
      createdAt: diasAtras(idadeEmDias),
      updatedAt: diasAtras(idadeEmDias),
    },
  })
}

describe('prazos', () => {
  test('ficam num lugar só: 90 dias de avisos e 2 anos de auditoria', () => {
    expect(RETENTION_DAYS).toEqual({ notifications: 90, audit: 730 })
  })
})

describe('runRetention', () => {
  test('apaga avisos terminados com mais de 90 dias e guarda os recentes e os pendentes', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    const velhos = await Promise.all((['SENT', 'FAILED', 'SKIPPED', 'CANCELED'] as const).map((s) => aviso(b.id, c.id, s, 91)))
    const pendenteVelho = await aviso(b.id, c.id, 'PENDING', 200)
    const recente = await aviso(b.id, c.id, 'SENT', 89)
    const naBorda = await aviso(b.id, c.id, 'FAILED', 89)

    const r = await runRetention(NOW)

    expect(r.avisos).toBe(4)
    const restam = (await prisma.notification.findMany()).map((n) => n.id).sort()
    expect(restam).toEqual([pendenteVelho.id, recente.id, naBorda.id].sort())
    expect(restam).not.toContain(velhos[0]?.id)
  })

  test('apaga a auditoria com mais de 2 anos', async () => {
    const velho = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', actorName: 'sistema', action: 'a', createdAt: diasAtras(731) } })
    const novo = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', actorName: 'sistema', action: 'b', createdAt: diasAtras(729) } })

    const r = await runRetention(NOW)

    expect(r.auditoria).toBe(1)
    expect((await prisma.auditLog.findMany()).map((l) => l.id)).toEqual([novo.id])
    expect(velho.id).not.toBe(novo.id)
  })

  test('apaga em lotes pequenos até acabar e conta tudo', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    for (let i = 0; i < 7; i += 1) await aviso(b.id, c.id, 'SENT', 100 + i)
    const r = await runRetention(NOW, { batchSize: 3 })
    expect(r.avisos).toBe(7)
    expect(await prisma.notification.count()).toBe(0)
  })

  test('o teto de lotes por rodada deixa o resto para a próxima', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id)
    for (let i = 0; i < 7; i += 1) await aviso(b.id, c.id, 'SENT', 100 + i)
    const primeira = await runRetention(NOW, { batchSize: 3, maxBatches: 2 })
    expect(primeira.avisos).toBe(6)
    expect(await prisma.notification.count()).toBe(1)
    expect((await runRetention(NOW, { batchSize: 3, maxBatches: 2 })).avisos).toBe(1)
  })

  test('sem nada para apagar devolve zeros', async () => {
    expect(await runRetention(NOW)).toEqual({ avisos: 0, auditoria: 0 })
  })
})

describe('registro da execução', () => {
  test('o banco aceita a tarefa retention em scheduler_runs', async () => {
    const agora = NOW
    await prisma.schedulerRun.create({ data: { kind: 'retention', startedAt: agora, finishedAt: agora, ok: true, summary: 'avisos 0, auditoria 0' } })
    expect(await prisma.schedulerRun.count({ where: { kind: 'retention' } })).toBe(1)
  })
})
