import { prisma } from '@/server/db/client'

afterAll(async () => {
  await prisma.$disconnect()
})

test('conecta no Postgres embutido', async () => {
  const rows = await prisma.$queryRaw<{ ok: number }[]>`select 1 as ok`
  expect(rows[0]?.ok).toBe(1)
})

test('extensões necessárias estão disponíveis', async () => {
  await prisma.$executeRawUnsafe('create extension if not exists btree_gist')
  await prisma.$executeRawUnsafe('create extension if not exists pgcrypto')
})

test('o servidor guarda instantes em UTC', async () => {
  const rows = await prisma.$queryRaw<{ t: Date }[]>`select '2026-11-13T12:00:00-03:00'::timestamptz as t`
  expect(rows[0]?.t.toISOString()).toBe('2026-11-13T15:00:00.000Z')
})
