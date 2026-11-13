import { execFileSync } from 'node:child_process'
import { startDb, TEST_DB } from '../../scripts/db'

export default async function setup() {
  const db = await startDb(TEST_DB)
  process.env.DATABASE_URL = db.url
  process.env.APP_SECRET = 'segredo-de-teste-com-no-minimo-32-caracteres-ok'

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  })

  return async () => {
    await db.stop()
  }
}
