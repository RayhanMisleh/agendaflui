// Partida do contêiner: valida o ambiente, espera o banco, aplica as migrações e inicia o Next.
// Roda com `node --import tsx scripts/start-production.ts` (PID 1 do contêiner) e repassa SIGTERM/SIGINT ao filho.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { runSelfCheck } from '../src/server/db/self-check'
import { migrationDatabaseUrl, parseEnv, runtimeDatabaseUrl } from '../src/server/env'
import { checkStorageDir } from '../src/server/storage/check'
import { shouldMigrate, waitForDatabase } from './start-helpers'

const TENTATIVAS_DO_BANCO = 30
const ESPERA_ENTRE_TENTATIVAS_MS = 2000
const LIMITE_DE_CONEXAO_MS = 2000

let filho: ChildProcess | null = null
let sinalRecebido: NodeJS.Signals | null = null

function log(texto: string): void {
  console.log(`[partida] ${texto}`)
}

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    sinalRecebido = sinal
    if (filho) filho.kill(sinal)
    else process.exit(0)
  })
}

/** Roda um processo filho até o fim, repassando sinais. Devolve o código de saída. */
function rodar(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((ok, falhou) => {
    const processo = spawn(process.execPath, args, { env, stdio: 'inherit' })
    filho = processo
    processo.on('error', falhou)
    processo.on('exit', (codigo) => {
      filho = null
      ok(codigo ?? 1)
    })
  })
}

async function bancoResponde(url: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: LIMITE_DE_CONEXAO_MS })
  // Sem este ouvinte um erro assíncrono do cliente derrubaria o processo com a mensagem do driver (que pode ter a URL).
  cliente.on('error', () => undefined)
  try {
    await cliente.connect()
    await cliente.query('SELECT 1')
  } finally {
    await cliente.end().catch(() => undefined)
  }
}

async function main(): Promise<number> {
  const config = parseEnv(process.env)
  if (config.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV precisa ser production para iniciar o servidor de produção.')
  }
  await checkStorageDir(config.STORAGE_DIR)
  log('Ambiente válido.')

  log('Esperando o banco aceitar conexão...')
  const urlDoServidor = runtimeDatabaseUrl(config)
  const urlDasMigracoes = migrationDatabaseUrl(config)
  const espera = { attempts: TENTATIVAS_DO_BANCO, delayMs: ESPERA_ENTRE_TENTATIVAS_MS }
  await waitForDatabase(() => bancoResponde(urlDoServidor), espera)
  if (urlDasMigracoes !== urlDoServidor && shouldMigrate(process.env)) await waitForDatabase(() => bancoResponde(urlDasMigracoes), espera)
  if (sinalRecebido) return 0

  log('Conferindo o banco (fuso UTC, travas e btree_gist)...')
  await runSelfCheck(urlDoServidor)
  if (sinalRecebido) return 0

  if (shouldMigrate(process.env)) {
    log('Aplicando as migrações (prisma migrate deploy)...')
    // O prisma.config.ts escolhe DIRECT_URL quando existe; aqui a escolha é explícita para as duas regras não divergirem.
    const codigo = await rodar([resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { ...process.env, DIRECT_URL: urlDasMigracoes })
    if (sinalRecebido) return 0
    if (codigo !== 0) throw new Error(`As migrações falharam (código ${codigo}). O servidor não foi iniciado.`)
  } else {
    log('MIGRATE_ON_START=false: migrações não aplicadas.')
  }

  const porta = process.env['PORT'] || '3000'
  log(`Iniciando o servidor na porta ${porta}.`)
  const codigo = await rodar([resolve('node_modules/next/dist/bin/next'), 'start', '-H', '0.0.0.0', '-p', porta], process.env)
  return sinalRecebido ? 0 : codigo
}

main().then(
  (codigo) => process.exit(codigo),
  (erro: unknown) => {
    console.error(`[partida] ${erro instanceof Error ? erro.message : 'Falha desconhecida na partida.'}`)
    process.exit(1)
  },
)
