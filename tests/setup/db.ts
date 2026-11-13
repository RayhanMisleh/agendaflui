import { prisma } from '@/server/db/client'

/** Esvazia todas as tabelas do schema public, exceto o histórico de migrações. */
export async function resetDb(): Promise<void> {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> '_prisma_migrations'
  `
  if (tabelas.length === 0) return
  const lista = tabelas.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`)
}
