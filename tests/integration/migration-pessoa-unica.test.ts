import type pg from 'pg'
import { expect, test } from 'vitest'
import { applyMigration, applyMigrationsThrough, withScratchDb } from '../setup/migrations'

const ANTES = '20261123080000_termos_fixos_e_slugs'
const MIGRACAO = '20261123090000_pessoa_unica'
const VERIFICADO = '2026-10-01T10:00:00Z'

async function loja(c: pg.Client, slug: string): Promise<string> {
  const r = await c.query<{ id: string }>(`INSERT INTO businesses (slug, name, search_name, updated_at) VALUES ($1, $1, $1, now()) RETURNING id`, [slug])
  return r.rows[0]?.id ?? ''
}

async function cliente(c: pg.Client, businessId: string, i: { email: string | null; hash?: string | null; verified?: boolean; name?: string }): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO customers (business_id, name, email, password_hash, email_verified_at, origin, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'APP', now()) RETURNING id`,
    [businessId, i.name ?? 'Cliente', i.email, i.hash ?? null, i.verified ? VERIFICADO : null],
  )
  return r.rows[0]?.id ?? ''
}

async function pessoa(c: pg.Client, email: string, hash: string | null): Promise<string> {
  const r = await c.query<{ id: string }>(`INSERT INTO users (name, search_name, email, password_hash, updated_at) VALUES ('Pessoa', 'pessoa', $1, $2, now()) RETURNING id`, [email, hash])
  return r.rows[0]?.id ?? ''
}

test('cliente com senha sem pessoa vira pessoa com a mesma senha e a verificação do cliente', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const b = await loja(c, 'loja-a')
    const cid = await cliente(c, b, { email: 'ana@exemplo.test', hash: 'hash-ana', verified: true, name: 'Ana' })
    await applyMigration(c, MIGRACAO)
    const u = (await c.query(`SELECT * FROM users WHERE email = 'ana@exemplo.test'`)).rows[0]
    expect(u.password_hash).toBe('hash-ana')
    expect(u.name).toBe('Ana')
    expect(new Date(u.email_verified_at).toISOString()).toBe('2026-10-01T10:00:00.000Z')
    const cl = (await c.query(`SELECT user_id, linked_at FROM customers WHERE id = $1`, [cid])).rows[0]
    expect(cl.user_id).toBe(u.id)
    expect(cl.linked_at).not.toBeNull()
  })
})

test('e-mail já de pessoa com senha: liga ao cliente e mantém a senha da pessoa', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const b = await loja(c, 'loja-a')
    const uid = await pessoa(c, 'ana@exemplo.test', 'hash-da-pessoa')
    const cid = await cliente(c, b, { email: 'ana@exemplo.test', hash: 'hash-do-cliente', verified: true })
    await applyMigration(c, MIGRACAO)
    const u = (await c.query(`SELECT password_hash, email_verified_at FROM users WHERE id = $1`, [uid])).rows[0]
    expect(u.password_hash).toBe('hash-da-pessoa')
    // A equipe com senha fica verificada pelo convite.
    expect(u.email_verified_at).not.toBeNull()
    expect((await c.query(`SELECT user_id FROM customers WHERE id = $1`, [cid])).rows[0].user_id).toBe(uid)
    expect((await c.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(1)
  })
})

test('e-mail de pessoa pendente: a pessoa recebe a senha e a verificação do cliente', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const b = await loja(c, 'loja-a')
    const uid = await pessoa(c, 'ana@exemplo.test', null)
    const cid = await cliente(c, b, { email: 'ana@exemplo.test', hash: 'hash-do-cliente', verified: true })
    await applyMigration(c, MIGRACAO)
    const u = (await c.query(`SELECT password_hash, email_verified_at FROM users WHERE id = $1`, [uid])).rows[0]
    expect(u.password_hash).toBe('hash-do-cliente')
    expect(new Date(u.email_verified_at).toISOString()).toBe('2026-10-01T10:00:00.000Z')
    expect((await c.query(`SELECT user_id FROM customers WHERE id = $1`, [cid])).rows[0].user_id).toBe(uid)
  })
})

test('mesmo e-mail com senha em duas lojas: uma pessoa e dois clientes ligados', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const a = await loja(c, 'loja-a')
    const b = await loja(c, 'loja-b')
    const c1 = await cliente(c, a, { email: 'ana@exemplo.test', hash: 'hash-1', verified: true })
    const c2 = await cliente(c, b, { email: 'ana@exemplo.test', hash: 'hash-2', verified: true })
    await applyMigration(c, MIGRACAO)
    expect((await c.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(1)
    const ids = (await c.query(`SELECT user_id FROM customers WHERE id IN ($1, $2)`, [c1, c2])).rows.map((r) => r.user_id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).not.toBeNull()
  })
})

test('equipe com senha fica verificada; convite pendente segue sem verificação', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const comSenha = await pessoa(c, 'equipe@exemplo.test', 'hash')
    const pendente = await pessoa(c, 'novo@exemplo.test', null)
    await applyMigration(c, MIGRACAO)
    const lido = async (id: string) => (await c.query(`SELECT email_verified_at FROM users WHERE id = $1`, [id])).rows[0].email_verified_at
    expect(await lido(comSenha)).not.toBeNull()
    expect(await lido(pendente)).toBeNull()
  })
})

test('cliente de balcão sem senha fica sem pessoa', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const b = await loja(c, 'loja-a')
    const cid = await cliente(c, b, { email: 'balcao@exemplo.test' })
    const sem = await cliente(c, b, { email: null, name: 'Sem e-mail' })
    await applyMigration(c, MIGRACAO)
    const linhas = (await c.query(`SELECT user_id, linked_at FROM customers WHERE id IN ($1, $2)`, [cid, sem])).rows
    expect(linhas.every((l) => l.user_id === null && l.linked_at === null)).toBe(true)
    expect((await c.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(0)
  })
})

test('customers perde password_hash e email_verified_at; verification_codes sai', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    await applyMigration(c, MIGRACAO)
    const colunas = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'customers'`)).rows.map((r) => r.column_name)
    expect(colunas).not.toContain('password_hash')
    expect(colunas).not.toContain('email_verified_at')
    expect(colunas).toEqual(expect.arrayContaining(['user_id', 'linked_at']))
    expect((await c.query(`SELECT to_regclass('verification_codes') AS t, to_regclass('email_codes') AS e`)).rows[0]).toEqual({ t: null, e: 'email_codes' })
    const tipos = (await c.query(`SELECT typname FROM pg_type WHERE typname IN ('verification_purpose', 'email_code_purpose')`)).rows.map((r) => r.typname)
    expect(tipos).toEqual(['email_code_purpose'])
  })
})

test('cliente com senha e sem e-mail faz a migração falhar com mensagem clara', async () => {
  await withScratchDb(async (c) => {
    await applyMigrationsThrough(c, ANTES)
    const b = await loja(c, 'loja-a')
    await cliente(c, b, { email: null, hash: 'hash' })
    const erro = await applyMigration(c, MIGRACAO).then(() => null, (e: unknown) => e)
    expect(String((erro as Error).message)).toContain('tem senha mas não tem e-mail')
  })
})
