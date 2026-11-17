// Fumaça por HTTP das telas do painel dev: sobe `next start`, entra com uma sessão temporária de admin e pede cada
// página da lista abaixo. Falha se alguma não responder 200 ou trouxer marca de erro do Next. Sem navegador.
// Antes: `npm run build` e o banco de desenvolvimento com o seed (este script sobe o banco se a porta 54329 estiver livre).
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { resolve } from 'node:path'
import { DEV_DB, startDb } from './db'
import type { RunningDb } from './db'
import { smokeRefusal } from './smoke-guard'

try {
  process.loadEnvFile()
} catch {
  // Sem .env: valem as variáveis do ambiente.
}

const DEV_COOKIE = 'af_dev_session'
const MARCAS_DE_ERRO = ['__next_error__', 'Application error', /Digest: \d+/]

/** Páginas pedidas. `{conta}` vira o id da primeira conta do seed. Acrescente aqui as telas novas de cada tarefa. */
const PAGINAS = [
  '/',
  '/contas',
  '/contas?search=x&status=ACTIVE',
  '/contas?search=%00',
  '/contas/nova',
  '/contas/{conta}',
  '/contas/{conta}?suporte=__proto__&faltou=constructor',
  '/contas/{conta}/marca',
  '/contas/{conta}/termos',
  '/contas/{conta}/modulos',
  '/contas/{conta}/regras',
  '/contas/{conta}/equipe',
  '/contas/{conta}/chaves',
  '/contas/{conta}/auditoria',
  '/chaves',
  '/chaves?tipo=PLATFORM&situacao=ativas&search=x',
  '/chaves?cursor=nao-existe&tipo=%00',
  '/sistema',
  '/auditoria',
  '/auditoria?de=2026-11-01&ate=2026-11-10&ator=PLATFORM_ADMIN&acao=api_key.revoked',
  '/auditoria?de=2026-01-01&ate=2026-12-31',
  '/auditoria?de=lixo&cursor=lixo',
  '/auditoria?acao=%00',
  '/auditoria?ator=ROOT',
  '/admins',
  '/perfil',
  '/vitrine',
]

type Resposta = { status: number; corpo: string }

function pedir(porta: number, host: string, caminho: string, cookie: string): Promise<Resposta> {
  return new Promise((ok, falhou) => {
    const req = request({ host: '127.0.0.1', port: porta, path: caminho, headers: { host, cookie: `${DEV_COOKIE}=${cookie}` } }, (res) => {
      const partes: Buffer[] = []
      res.on('data', (p: Buffer) => partes.push(p))
      res.on('end', () => ok({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
    })
    req.on('error', falhou)
    req.setTimeout(60_000, () => req.destroy(new Error('sem resposta em 60 s')))
    req.end()
  })
}

function portaOcupada(porta: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = connect({ port: porta, host: '127.0.0.1' })
    s.on('connect', () => {
      s.destroy()
      ok(true)
    })
    s.on('error', () => ok(false))
  })
}

function portaLivre(): Promise<number> {
  return new Promise((ok, falhou) => {
    const s = createServer()
    s.on('error', falhou)
    s.listen(0, '127.0.0.1', () => {
      const porta = (s.address() as { port: number }).port
      s.close(() => ok(porta))
    })
  })
}

function rodar(comando: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((ok, falhou) => {
    const filho = spawn(comando, args, { env, stdio: 'inherit' })
    filho.on('error', falhou)
    filho.on('exit', (c) => (c === 0 ? ok() : falhou(new Error(`${args.join(' ')} terminou com código ${c}.`))))
  })
}

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

async function main(): Promise<number> {
  let db: RunningDb | null = null
  let servidor: ChildProcess | null = null
  let limpar: (() => Promise<void>) | null = null
  let encerrado = false
  // O mesmo encerramento para o fim normal e para Ctrl+C/SIGTERM: apaga a sessão e encerra o que este script subiu.
  const encerrar = async (): Promise<void> => {
    if (encerrado) return
    encerrado = true
    if (servidor && !servidor.killed) servidor.kill('SIGTERM')
    if (limpar) await limpar().catch(() => undefined)
    if (db) await db.stop().catch(() => undefined)
  }
  for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sinal, () => {
      void encerrar().finally(() => process.exit(130))
    })
  }
  try {
    // Antes de qualquer escrita: só em banco local e fora de produção.
    const recusa = smokeRefusal(process.env)
    if (recusa) throw new Error(recusa)
    // Banco: se a 54329 está ocupada, é o banco de desenvolvimento de outra pessoa; usa sem encerrar.
    const ocupada = await portaOcupada(DEV_DB.port)
    let url = process.env.DATABASE_URL || `postgres://agendaflui:agendaflui@localhost:${DEV_DB.port}/${DEV_DB.database}`
    if (!ocupada) {
      db = await startDb(DEV_DB)
      url = db.url
    }
    process.env.DATABASE_URL = url
    const recusaFinal = smokeRefusal({ NODE_ENV: process.env.NODE_ENV, DATABASE_URL: url })
    if (recusaFinal) throw new Error(recusaFinal)
    const env = { ...process.env, DATABASE_URL: url }
    if (db) await rodar('npx', ['prisma', 'migrate', 'deploy'], env)

    const { prisma } = await import('../src/server/db/client')
    const { hashToken, generateToken } = await import('../src/server/auth/tokens')
    const { addMinutes } = await import('../src/server/time')
    if (db) {
      const { seed } = await import('../prisma/seed')
      if ((await prisma.business.count()) === 0) await seed(prisma, process.env)
    }
    const admin = await prisma.platformAdmin.findFirst({ where: { active: true }, select: { id: true } })
    const conta = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!admin || !conta) throw new Error('O banco não tem admin nem conta de demonstração. Rode `npm run dev` uma vez para criar o seed.')

    const { token, hash } = generateToken()
    const sessao = await prisma.platformSession.create({ data: { adminId: admin.id, tokenHash: hash, expiresAt: addMinutes(new Date(), 30) } })
    limpar = async () => {
      await prisma.platformSession.deleteMany({ where: { id: sessao.id, tokenHash: hashToken(token) } })
      await prisma.$disconnect()
    }

    const porta = await portaLivre()
    const host = `dev.localhost:${porta}`
    servidor = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(porta)], {
      env: { ...env, DEV_HOST: host, PAINEL_HOST: `painel.localhost:${porta}`, API_HOST: `api.localhost:${porta}`, WORKER_ENABLED: 'false' },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    let encerrou = false
    servidor.on('exit', () => {
      encerrou = true
    })
    for (let i = 0; ; i++) {
      if (encerrou) throw new Error('O servidor encerrou antes de responder. Rode `npm run build` e tente de novo.')
      if (i > 120) throw new Error('O servidor não respondeu em 60 s.')
      if (await portaOcupada(porta)) break
      await dormir(500)
    }

    let falhas = 0
    for (const modelo of PAGINAS) {
      const caminho = modelo.replace('{conta}', conta.id)
      let linha: string
      try {
        const r = await pedir(porta, host, caminho, token)
        const marca = MARCAS_DE_ERRO.find((m) => (typeof m === 'string' ? r.corpo.includes(m) : m.test(r.corpo)))
        const bom = r.status === 200 && marca === undefined
        if (!bom) falhas++
        linha = `${bom ? 'OK   ' : 'FALHA'} ${String(r.status)} ${modelo}${marca ? `  (marca de erro: ${String(marca)})` : ''}`
      } catch (err) {
        falhas++
        linha = `FALHA --- ${modelo}  (${err instanceof Error ? err.message : 'erro'})`
      }
      console.log(linha)
    }
    console.log(falhas === 0 ? `\nFumaça: ${PAGINAS.length} páginas responderam 200 sem marca de erro.` : `\nFumaça: ${falhas} de ${PAGINAS.length} páginas falharam.`)
    return falhas === 0 ? 0 : 1
  } finally {
    await encerrar()
  }
}

// Sem process.exit: o banco embutido precisa terminar o desligamento por conta própria.
main().then(
  (codigo) => {
    process.exitCode = codigo
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  },
)
