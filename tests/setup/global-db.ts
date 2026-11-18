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
    // Cada TRUNCATE do resetDb troca o arquivo de ~250 tabelas e índices, e o Postgres só apaga os arquivos velhos no próximo
    // checkpoint. Com o padrão (5 min e 1 GB de WAL) a suíte inteira deixa centenas de milhares de arquivos soltos e
    // `pg_database_size` (usado no painel de sistema) passa de 5 s. Checkpoints a cada 30 s mantêm o diretório pequeno.
    await admin.query(`ALTER SYSTEM SET checkpoint_timeout = '30s'`)
    await admin.query(`ALTER SYSTEM SET max_wal_size = '128MB'`)
    await admin.query('SELECT pg_reload_conf()')
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
