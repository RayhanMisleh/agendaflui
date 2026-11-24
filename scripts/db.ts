import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

const USUARIO = 'agendaflui'
const SENHA = 'agendaflui'

export const DEV_DB = { dataDir: '.local/pg', port: 54329, database: 'agendaflui' }
// TEST_DB_PORT permite rodar várias suítes ao mesmo tempo (uma por cópia de trabalho), cada uma no seu banco.
export const TEST_DB = { dataDir: '.local/pg-test', port: Number(process.env['TEST_DB_PORT'] || 54330), database: 'agendaflui_test' }

export type StartDbOptions = { dataDir: string; port: number; database: string }
export type RunningDb = { url: string; stop(): Promise<void> }

/** Falha ao iniciar o Postgres embutido, carregando o log que ele emitiu antes de fechar. */
export class DbStartError extends Error {
  constructor(
    message: string,
    readonly log: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'DbStartError'
  }
}

const PORTA_OCUPADA = /address already in use|could not bind|EADDRINUSE|endere[çc]o j[áa] em uso/i

export function describeStartFailure(err: unknown, port: number): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  const mensagem = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const log = err instanceof DbStartError ? err.log : ''
  if (code === 'EADDRINUSE' || PORTA_OCUPADA.test(`${mensagem}\n${log}`)) {
    return `A porta ${port} já está em uso. Feche o outro banco ou programa que a usa e tente de novo.`
  }
  const detalhe = (log.trim() || mensagem.trim()).split('\n').filter(Boolean).slice(-3).join(' ')
  return detalhe
    ? `Não foi possível iniciar o banco local: ${detalhe}. Confira se há outro banco rodando; como último recurso, rode npm run db:reset para recriar o banco local vazio.`
    : 'Não foi possível iniciar o banco local. Confira se há outro banco rodando; como último recurso, rode npm run db:reset para recriar o banco local vazio.'
}

/** Apaga postmaster.pid quando o processo dono dele já morreu. Retorna true se apagou. */
export function removeStalePidFile(dataDir: string): boolean {
  const arquivo = join(dataDir, 'postmaster.pid')
  if (!existsSync(arquivo)) return false
  const pid = Number.parseInt(readFileSync(arquivo, 'utf8').split('\n')[0] ?? '', 10)
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0)
      return false
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return false
    }
  }
  rmSync(arquivo, { force: true })
  return true
}

export async function startDb(opts: StartDbOptions): Promise<RunningDb> {
  const dataDir = resolve(opts.dataDir)
  const linhas: string[] = []
  const registrar = (entrada: unknown) => {
    linhas.push(entrada instanceof Error ? entrada.message : String(entrada))
  }
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: opts.port,
    user: USUARIO,
    password: SENHA,
    persistent: true,
    // O servidor trabalha sempre em UTC; a conversão para o fuso do cliente é da camada src/server/time.
    postgresFlags: ['-c', 'timezone=UTC', '-c', 'log_timezone=UTC'],
    onLog: registrar,
    onError: registrar,
  })

  try {
    if (!existsSync(join(dataDir, 'PG_VERSION'))) await pg.initialise()
    removeStalePidFile(dataDir)
    await pg.start()
    const client = pg.getPgClient()
    await client.connect()
    try {
      const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [opts.database])
      if (!rowCount) await pg.createDatabase(opts.database)
    } finally {
      await client.end()
    }
  } catch (err) {
    const falha = err instanceof DbStartError ? err : new DbStartError(err instanceof Error ? err.message : '', linhas.join('\n'), { cause: err })
    throw new Error(describeStartFailure(falha, opts.port), { cause: err })
  }

  return {
    url: `postgres://${USUARIO}:${SENHA}@localhost:${opts.port}/${opts.database}`,
    stop: () => pg.stop(),
  }
}

async function main(comando: string | undefined) {
  if (comando === 'reset') {
    rmSync(resolve(DEV_DB.dataDir), { recursive: true, force: true })
    const db = await startDb(DEV_DB)
    await db.stop()
    console.log('Banco local recriado vazio. Rode npm run db:migrate para criar as tabelas.')
    return
  }
  if (comando === 'start') {
    const db = await startDb(DEV_DB)
    console.log(`Banco local pronto em ${db.url}\nPressione Ctrl+C para parar.`)
    const parar = () => {
      db.stop().finally(() => process.exit(0))
    }
    process.on('SIGINT', parar)
    process.on('SIGTERM', parar)
    setInterval(() => {}, 1 << 30)
    return
  }
  console.error('Uso: tsx scripts/db.ts start | reset')
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
