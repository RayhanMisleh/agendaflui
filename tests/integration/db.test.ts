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

test('a sessão do cliente é sempre UTC, mesmo com o banco configurado em outro fuso', async () => {
  const padrao = await prisma.$queryRaw<{ v: string }[]>`
    select lower(setting) as v from pg_db_role_setting s
    join pg_database d on d.oid = s.setdatabase, unnest(s.setconfig) as setting
    where d.datname = current_database()`
  expect(padrao.map((r) => r.v)).toContain('timezone=america/sao_paulo')
  const sessao = await prisma.$queryRaw<{ TimeZone: string }[]>`show timezone`
  expect(sessao[0]?.TimeZone).toBe('UTC')
})
