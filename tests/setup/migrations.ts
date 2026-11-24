import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const PASTA = join(process.cwd(), 'prisma', 'migrations')

/** Nomes das migrações em ordem (o timestamp do nome ordena). */
function migracoes(): string[] {
  return readdirSync(PASTA, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function urlDoBanco(base: string, banco: string): string {
  const url = new URL(base)
  url.pathname = `/${banco}`
  return url.toString()
}

/**
 * Cria um banco descartável no Postgres de teste (`DATABASE_URL`), conecta nele, roda `fn` e derruba o banco no fim, mesmo
 * com erro. Serve para testar migrações sem mexer no banco compartilhado dos outros testes.
 */
export async function withScratchDb(fn: (c: pg.Client) => Promise<void>): Promise<void> {
  const base = process.env['DATABASE_URL']
  if (!base) throw new Error('DATABASE_URL não está definida: o banco de teste não subiu.')
  const nome = `agendaflui_migr_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${nome}`)
    const c = new pg.Client({ connectionString: urlDoBanco(base, nome) })
    await c.connect()
    try {
      await fn(c)
    } finally {
      await c.end()
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`)
    await admin.end()
  }
}

/** Aplica, em ordem, as migrações até `lastName` (inclusive). */
export async function applyMigrationsThrough(c: pg.Client, lastName: string): Promise<void> {
  const todas = migracoes()
  if (!todas.includes(lastName)) throw new Error(`Migração ${lastName} não existe.`)
  for (const nome of todas) {
    await applyMigration(c, nome)
    if (nome === lastName) return
  }
}

/** Aplica o SQL de uma migração (cada arquivo traz o próprio BEGIN/COMMIT). */
export async function applyMigration(c: pg.Client, name: string): Promise<void> {
  await c.query(readFileSync(join(PASTA, name, 'migration.sql'), 'utf8'))
}
