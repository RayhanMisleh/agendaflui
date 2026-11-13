import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { startDb, TEST_DB } from '../../scripts/db'

export default async function setup() {
  const db = await startDb(TEST_DB)
  process.env.DATABASE_URL = db.url

  // O banco de teste fica de propósito com um fuso que não é UTC: a garantia de UTC vem do cliente.
  const admin = new pg.Client({ connectionString: db.url })
  await admin.connect()
  try {
    await admin.query(`ALTER DATABASE ${TEST_DB.database} SET timezone TO 'America/Sao_Paulo'`)
  } finally {
    await admin.end()
  }
  process.env.APP_SECRET = 'segredo-de-teste-com-no-minimo-32-caracteres-ok'

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  })

  return async () => {
    await db.stop()
  }
}
