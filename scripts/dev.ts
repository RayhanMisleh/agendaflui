import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { DEV_DB, startDb, type RunningDb } from './db'

try {
  process.loadEnvFile()
} catch {
  // Sem .env: valem as variáveis do ambiente.
}

const PORTA = 3000

function frase(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? ''
}

function rodar(comando: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((ok, falhou) => {
    const filho = spawn(comando, args, { env, stdio: 'inherit' })
    filho.on('error', falhou)
    filho.on('exit', (codigo) => (codigo === 0 ? ok() : falhou(new Error(`${args.join(' ')} terminou com código ${codigo}.`))))
  })
}

async function parar(db: RunningDb): Promise<void> {
  await db.stop().catch(() => undefined)
}

async function main(): Promise<void> {
  let db: RunningDb
  try {
    db = await startDb(DEV_DB)
  } catch (err) {
    // startDb já devolve a mensagem pronta (describeStartFailure).
    console.error(frase(err))
    process.exit(1)
  }
  const env = { ...process.env, DATABASE_URL: db.url }
  process.env.DATABASE_URL = db.url

  try {
    await rodar('npx', ['prisma', 'migrate', 'deploy'], env)
  } catch (err) {
    console.error(`Não foi possível aplicar as migrações do banco: ${frase(err)}`)
    await parar(db)
    process.exitCode = 1
    return
  }

  try {
    const { prisma } = await import('../src/server/db/client')
    try {
      const { seed, textoDoResumo } = await import('../prisma/seed')
      // O seed só cria o que falta; num banco completo não faz nada (e não imprime nada).
      const vazio = (await prisma.business.count()) === 0
      const { emails, agenda } = await seed(prisma, process.env)
      if (vazio || agenda.length > 0) {
        console.log(`Dados de demonstração criados. Contas de acesso: ${emails.join(', ')}.`)
        for (const resumo of agenda) console.log(textoDoResumo(resumo))
        console.log('As senhas de demonstração estão no .env.')
      }
    } finally {
      await prisma.$disconnect()
    }
  } catch (err) {
    // Seed incompleto já vem com a frase pronta (e a ação a tomar).
    const pronta = err instanceof Error && err.name === 'SeedIncompletoError'
    console.error(pronta ? frase(err) : `Não foi possível criar os dados de demonstração: ${frase(err)}`)
    await parar(db)
    process.exitCode = 1
    return
  }

  const hosts = {
    dev: process.env.DEV_HOST || 'dev.localhost:3000',
    painel: process.env.PAINEL_HOST || 'painel.localhost:3000',
    api: process.env.API_HOST || 'api.localhost:3000',
  }
  console.log(`\nPainel dev:  http://${hosts.dev}\nPainel:      http://${hosts.painel}\nAPI:         http://${hosts.api}\n`)

  const next: ChildProcess = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '-p', String(PORTA)], {
    env,
    stdio: 'inherit',
  })

  let encerrando = false
  const encerrar = (codigo: number) => {
    if (encerrando) return
    encerrando = true
    parar(db).finally(() => process.exit(codigo))
  }
  next.on('exit', (codigo) => encerrar(codigo ?? 0))
  next.on('error', (err) => {
    console.error(`Não foi possível iniciar o Next: ${frase(err)}`)
    encerrar(1)
  })
  for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sinal, () => {
      // O Next encerra e o evento "exit" dele desliga o banco; se não responder, desliga assim mesmo.
      next.kill('SIGTERM')
      setTimeout(() => encerrar(0), 5_000).unref()
    })
  }
}

main().catch((err: unknown) => {
  console.error(frase(err))
  process.exit(1)
})
