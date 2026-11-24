import { expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { RESERVED_SLUGS } from '@/shared/reserved-slugs'
import { applyMigration, applyMigrationsThrough, withScratchDb } from '../setup/migrations'

// Aplicar a pilha de migrações num banco novo passa de 5 s com a suíte inteira rodando em paralelo.
vi.setConfig({ testTimeout: 30_000 })

const ANTES = '20261123070000_sem_api_e_push'
const MIGRACAO = '20261123080000_termos_fixos_e_slugs'

test('loja com slug reservado faz a migração falhar com mensagem clara', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    await c.query(`INSERT INTO businesses (slug, name, search_name, updated_at) VALUES ('painel', 'X', 'x', now())`)
    const erro = await applyMigration(c, MIGRACAO).then(() => null, (e: unknown) => e)
    expect(erro).toBeInstanceOf(Error)
    expect(String((erro as Error).message)).toContain('slug reservado')
    expect(String((erro as Error).message)).toContain('painel')
    // A transação toda foi desfeita: a coluna `segment` continua lá.
    await c.query('ROLLBACK')
    const col = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'businesses' AND column_name = 'segment'`)
    expect(col.rowCount).toBe(1)
  })
})

test('sem slug reservado a migração passa e o banco recusa slug reservado novo', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    await c.query(`INSERT INTO businesses (slug, name, search_name, updated_at) VALUES ('loja-boa', 'Loja', 'loja', now())`)
    await applyMigration(c, MIGRACAO)
    const colunas = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'business_settings' AND column_name LIKE 'term_%'`)
    expect(colunas.rowCount).toBe(0)
    await expect(c.query(`INSERT INTO businesses (slug, name, search_name, updated_at) VALUES ('google', 'G', 'g', now())`)).rejects.toThrow(/businesses_slug_not_reserved/)
    await c.query(`INSERT INTO businesses (slug, name, search_name, updated_at) VALUES ('minha-loja', 'M', 'm', now())`)
  })
})

test('o CHECK do banco tem exatamente a lista de RESERVED_SLUGS', async () => {
  const r = await prisma.$queryRaw<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'businesses_slug_not_reserved'`
  const def = r[0]?.def ?? ''
  const nomes = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '')
  expect(nomes.length).toBeGreaterThan(0)
  expect([...new Set(nomes)].sort()).toEqual([...RESERVED_SLUGS].sort())
})
