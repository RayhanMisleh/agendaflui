import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { hashPassword, passwordSchema } from '../src/server/auth/password'
import type { MembershipRole, PrismaClient } from '../src/server/db/generated/client'
import { DEMO_CONTAS, DEMO_MULTI_NOME, demoEmail, type DemoPapel } from './seed-data'

/** Variáveis lidas pelo seed (SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD, SEED_MULTI_EMAIL). */
export type SeedEnv = Record<string, string | undefined>

const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.'))

const envSchema = z.object({
  SEED_ADMIN_EMAIL: emailSchema,
  SEED_ADMIN_PASSWORD: passwordSchema,
  SEED_USER_PASSWORD: passwordSchema,
  SEED_MULTI_EMAIL: emailSchema,
})

const PAPEIS: Record<DemoPapel, MembershipRole> = { dono: 'OWNER', gerente: 'MANAGER', profissional: 'PROFESSIONAL' }

/** Valida as variáveis do seed e devolve uma frase só quando algo falta. */
function lerEnv(env: SeedEnv): z.infer<typeof envSchema> {
  const r = envSchema.safeParse(env)
  if (r.success) return r.data
  const campos = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(', ')
  throw new Error(`Variáveis do seed ausentes ou inválidas (${campos}). Confira o .env com base no .env.example.`)
}

export type SeedResult = { emails: string[] }

/**
 * Cria o administrador e as duas contas de demonstração. Pode rodar quantas vezes quiser:
 * o que já existe não é alterado nem duplicado, e as senhas só são gravadas na criação.
 */
export async function seed(prisma: PrismaClient, rawEnv: SeedEnv): Promise<SeedResult> {
  const env = lerEnv(rawEnv)
  const emails: string[] = []

  const admin = await prisma.platformAdmin.findUnique({ where: { email: env.SEED_ADMIN_EMAIL } })
  if (!admin) {
    await prisma.platformAdmin.create({
      data: { name: 'Admin AgendaFlui', email: env.SEED_ADMIN_EMAIL, passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD) },
    })
  }
  emails.push(env.SEED_ADMIN_EMAIL)

  async function usuario(name: string, email: string): Promise<string> {
    const normalizado = emailSchema.parse(email)
    const existente = await prisma.user.findUnique({ where: { email: normalizado } })
    emails.push(normalizado)
    if (existente) return existente.id
    const criado = await prisma.user.create({
      data: { name, email: normalizado, passwordHash: await hashPassword(env.SEED_USER_PASSWORD) },
    })
    return criado.id
  }

  async function vinculo(businessId: string, userId: string, role: MembershipRole): Promise<void> {
    await prisma.membership.upsert({
      where: { businessId_userId: { businessId, userId } },
      create: { businessId, userId, role },
      update: {},
    })
  }

  const multiId = await usuario(DEMO_MULTI_NOME, env.SEED_MULTI_EMAIL)

  for (const conta of DEMO_CONTAS) {
    const negocio = await prisma.business.upsert({
      where: { slug: conta.slug },
      create: {
        slug: conta.slug,
        name: conta.nome,
        segment: conta.segmento,
        timezone: conta.fuso,
        branding: { create: { displayName: conta.nome, ...conta.marca } },
        modules: { create: conta.modulos },
        settings: { create: conta.termos },
      },
      update: {},
    })
    for (const papel of ['dono', 'gerente', 'profissional'] as const) {
      const userId = await usuario(conta.equipe[papel], demoEmail(conta.chave, papel))
      await vinculo(negocio.id, userId, PAPEIS[papel])
    }
    await vinculo(negocio.id, multiId, 'OWNER')
  }

  return { emails }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Sem .env: valem as variáveis do ambiente.
  }
  const { prisma } = await import('../src/server/db/client')
  try {
    const { emails } = await seed(prisma, process.env)
    console.log(`Dados de demonstração prontos. Contas de acesso: ${emails.join(', ')}.`)
    console.log('As senhas de demonstração estão no .env.')
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
