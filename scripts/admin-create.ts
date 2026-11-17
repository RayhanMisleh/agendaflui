import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import { z } from 'zod'

try {
  process.loadEnvFile()
} catch {
  // Sem .env: valem as variáveis do ambiente.
}

const TENTATIVAS = 3
let mudo = false
const saida = new Writable({
  write(trecho, _codificacao, pronto) {
    if (!mudo) process.stdout.write(trecho)
    pronto()
  },
})
const entrada = createInterface({ input: process.stdin, output: saida, terminal: true })

/** Pergunta até a resposta passar na validação; a senha digitada não aparece na tela. */
async function perguntar<T>(rotulo: string, schema: z.ZodType<T>, secreto = false): Promise<T> {
  for (let i = 0; i < TENTATIVAS; i++) {
    process.stdout.write(`${rotulo}: `)
    mudo = secreto
    const resposta = await entrada.question('')
    mudo = false
    if (secreto) process.stdout.write('\n')
    const r = schema.safeParse(resposta)
    if (r.success) return r.data
    console.error(r.error.issues[0]?.message ?? 'Valor inválido.')
  }
  throw new Error('Valor inválido três vezes seguidas. Rode o comando de novo.')
}

async function main(): Promise<void> {
  const [{ prisma }, { hashPassword, passwordSchema }] = await Promise.all([
    import('../src/server/db/client'),
    import('../src/server/auth/password'),
  ])
  try {
    const name = await perguntar('Nome', z.string().trim().min(2, 'Informe o nome (pelo menos 2 letras).').max(120))
    const email = await perguntar('E-mail', z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail válido.')))
    const password = await perguntar('Senha', passwordSchema, true)
    if (await prisma.platformAdmin.findUnique({ where: { email } })) {
      throw new Error('Já existe um administrador com este e-mail.')
    }
    await prisma.platformAdmin.create({ data: { name, email, passwordHash: await hashPassword(password) } })
    console.log(`Administrador criado: ${email}.`)
  } finally {
    entrada.close()
    await prisma.$disconnect()
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  const semBanco = /ECONNREFUSED|connect|Can't reach/i.test(msg) && !/Já existe/.test(msg)
  console.error(semBanco ? 'Não foi possível falar com o banco. Confira DATABASE_URL (em desenvolvimento, rode npm run dev em outro terminal) e tente de novo.' : msg.split('\n')[0])
  process.exit(1)
})
