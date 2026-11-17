import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { hashPassword, passwordSchema } from '../src/server/auth/password'
import { searchKey } from '../src/server/domain/customers/contact'
import type { MembershipRole, PrismaClient } from '../src/server/db/generated/client'
import { randomBytes } from 'node:crypto'
import {
  DEMO_ADMIN_INATIVO,
  DEMO_CLOSURE_REASON,
  DEMO_CONTAS,
  DEMO_CONTA_SUSPENSA,
  DEMO_EXECUCOES,
  DEMO_MULTI_NOME,
  DEMO_ROTAS_USO,
  demoEmail, type DemoAgenda,
  type DemoPapel,
} from './seed-data'
import { planejarAgenda } from './seed-plan'
import { addMinutes, fromEpochMs, startOfUtcHour } from '../src/server/time'

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

export type AgendaResumo = { slug: string; nome: string; servicos: number; profissionais: number; clientes: number; agendamentos: number }

/** Execução interrompida: a conta tem serviços, mas a auditoria de conclusão (o último passo) não existe. */
export class SeedIncompletoError extends Error {
  constructor(conta: string) {
    super(`Os dados de demonstração de ${conta} ficaram incompletos. Rode npm run db:reset e inicie de novo.`)
    this.name = 'SeedIncompletoError'
  }
}

const SEED_DONE_ACTION = 'seed.demo_completed'

/** Chaves de app de demonstração: quantas esta execução criou e, se alguma não tem segredo guardado, a frase do aviso. */
export type ChavesResumo = { criadas: number; aviso: string | null }

export type SeedResult = { emails: string[]; agenda: AgendaResumo[]; chaves: ChavesResumo }

const ORIGENS_DEMO = ['http://*.localhost:3000', 'http://localhost:3000']

async function lerSegredos(arquivo: string): Promise<Record<string, string>> {
  try {
    const dado: unknown = JSON.parse(await readFile(arquivo, 'utf8'))
    const r = z.record(z.string(), z.string()).safeParse(dado)
    return r.success ? r.data : {}
  } catch {
    return {}
  }
}

/**
 * Uma chave de conta por conta de demonstração e uma de plataforma, criadas pela função de domínio. O segredo só existe
 * no retorno dela: vai para o arquivo (modo 0600) e nunca é impresso. Chave que já existe não é recriada; se o segredo
 * dela não está no arquivo, só avisa (recriar exige `npm run db:reset`, que o seed nunca faz sozinho).
 */
async function chavesDeDemonstracao(
  prisma: PrismaClient,
  arquivo: string,
  admin: { id: string; name: string },
  contas: { slug: string; name: string; id: string }[],
): Promise<ChavesResumo> {
  const { createApiKey } = await import('../src/server/domain/platform/api-keys')
  const ator = { kind: 'platform_admin' as const, adminId: admin.id, name: admin.name }
  const segredos = await lerSegredos(arquivo)
  const alvos = [
    ...contas.map((c) => ({ rotulo: c.slug, nome: `Demonstração ${c.name}`, kind: 'ACCOUNT' as const, businessId: c.id })),
    { rotulo: 'plataforma', nome: 'Demonstração da plataforma', kind: 'PLATFORM' as const, businessId: null },
  ]
  let criadas = 0
  let perdidas = 0
  for (const alvo of alvos) {
    const existente = await prisma.apiKey.findFirst({
      where: { name: alvo.nome, kind: alvo.kind, businessId: alvo.businessId, revokedAt: null },
    })
    if (existente) {
      if (segredos[alvo.rotulo]?.split('_')[2] !== existente.prefix) perdidas += 1
      continue
    }
    const { secret } = await createApiKey(ator, {
      kind: alvo.kind,
      ...(alvo.businessId === null ? {} : { businessId: alvo.businessId }),
      name: alvo.nome,
      allowedOrigins: ORIGENS_DEMO,
    })
    segredos[alvo.rotulo] = secret
    criadas += 1
    // Grava a cada chave: se a seguinte falhar, o segredo desta (que só existe agora) não se perde.
    await mkdir(dirname(arquivo), { recursive: true })
    await writeFile(arquivo, `${JSON.stringify(segredos, null, 2)}\n`, { mode: 0o600 })
    await chmod(arquivo, 0o600)
  }
  const aviso =
    perdidas > 0
      ? `Há chaves de demonstração sem segredo guardado em ${arquivo}: não dá para recuperá-las. Rode npm run db:reset para recriar tudo.`
      : null
  return { criadas, aviso }
}

type AdminAtor = { kind: 'platform_admin'; adminId: string; name: string }

/** Segundo admin da plataforma, desativado pelo domínio. Já existe: não mexe (o admin pode tê-lo reativado de propósito). */
async function adminInativo(prisma: PrismaClient, ator: AdminAtor, now: Date): Promise<void> {
  if (await prisma.platformAdmin.findUnique({ where: { email: DEMO_ADMIN_INATIVO.email } })) return
  const { createAdmin, setAdminActive } = await import('../src/server/domain/platform/admins')
  // Senha aleatória que ninguém conhece: o admin nunca entra, só aparece desativado na lista.
  const senha = `${randomBytes(24).toString('base64url')}-Aa1`
  const criado = await createAdmin(ator, { name: DEMO_ADMIN_INATIVO.nome, email: DEMO_ADMIN_INATIVO.email, password: senha })
  await setAdminActive(ator, criado.id, false, now)
}

/**
 * Conta suspensa: criada e suspensa só na primeira vez; se já existe, o que o admin fez com ela vale. A exceção é a conta
 * que a rodada anterior criou mas não chegou a suspender (falha entre as duas transações): ativa e sem nenhuma auditoria de
 * mudança de situação feita por admin, ela é suspensa agora.
 */
async function contaSuspensa(prisma: PrismaClient, ator: AdminAtor, donoId: string, now: Date): Promise<void> {
  const c = DEMO_CONTA_SUSPENSA
  const { setBusinessStatus } = await import('../src/server/domain/platform/businesses')
  const existente = await prisma.business.findUnique({ where: { slug: c.slug }, select: { id: true, status: true } })
  if (existente) {
    await prisma.business.update({ where: { id: existente.id }, data: { searchName: searchKey(c.nome) } })
    if (existente.status !== 'ACTIVE') return
    const mudou = await prisma.auditLog.count({ where: { businessId: existente.id, action: 'business.status_changed', actorType: 'PLATFORM_ADMIN' } })
    if (mudou === 0) await setBusinessStatus(ator, existente.id, 'SUSPENDED', { confirmName: c.nome }, now)
    return
  }
  const negocio = await prisma.business.create({
    data: {
      slug: c.slug,
      name: c.nome,
      searchName: searchKey(c.nome),
      segment: c.segmento,
      timezone: c.fuso,
      branding: { create: { displayName: c.nome } },
      modules: { create: {} },
      settings: { create: {} },
      memberships: { create: { userId: donoId, role: 'OWNER' } },
    },
  })
  await setBusinessStatus(ator, negocio.id, 'SUSPENDED', { confirmName: c.nome }, now)
}

/**
 * Uso da API das últimas 48 horas cheias, por chave de conta e rota, no formato que `recordUsage` acumula. Valores
 * determinísticos (sem sorteio); só quando a tabela está vazia, porque `writeUsageRows` soma em vez de substituir.
 */
async function usoDeDemonstracao(prisma: PrismaClient, now: Date): Promise<void> {
  if ((await prisma.apiUsageHourly.count()) > 0) return
  const chaves = await prisma.apiKey.findMany({
    where: { kind: 'ACCOUNT', revokedAt: null, name: { startsWith: 'Demonstração' }, businessId: { not: null } },
    orderBy: { name: 'asc' },
  })
  const { writeUsageRows } = await import('../src/server/domain/platform/api-usage')
  const fimDaHora = startOfUtcHour(now)
  const linhas = []
  for (const [c, chave] of chaves.entries()) {
    if (chave.businessId === null) continue
    for (let h = 1; h <= 48; h++) {
      // Mais tráfego de dia que de madrugada (hora UTC; é só um desenho plausível).
      const hora = addMinutes(fimDaHora, -60 * h)
      const hDia = (hora.getTime() / 3_600_000) % 24
      const carga = hDia >= 11 && hDia <= 23 ? 3 : 1
      for (const [r, rota] of DEMO_ROTAS_USO.entries()) {
        const count = rota.peso * carga + ((h * 7 + r * 3 + c) % 5)
        const errorCount = (h + r * 5 + c) % 13 === 0 ? 1 + (h % 2) : 0
        const totalMs = count * rota.ms + ((h * 13) % 30)
        linhas.push({
          apiKeyId: chave.id,
          businessId: chave.businessId,
          route: rota.rota,
          hour: hora,
          count,
          errorCount: Math.min(errorCount, count),
          totalMs,
          maxMs: Math.min(totalMs, rota.ms * 3 + ((h * 11) % 40)),
        })
      }
    }
  }
  await writeUsageRows(linhas)
}

/** Execuções do agendador no formato de `recordSchedulerRun` (uma com falha); só quando a tabela está vazia. */
async function execucoesDeDemonstracao(prisma: PrismaClient, now: Date): Promise<void> {
  const { recordSchedulerRun, summarize } = await import('../src/server/notifications/scheduler-runs')
  if ((await prisma.schedulerRun.count()) > 0) return
  for (const e of DEMO_EXECUCOES) {
    const startedAt = addMinutes(now, -e.minutosAtras)
    await recordSchedulerRun({
      kind: e.kind,
      startedAt,
      finishedAt: fromEpochMs(startedAt.getTime() + 1500),
      ok: !('falha' in e),
      // Mesmo formato de `failureSummary`: só o nome do erro.
      summary: 'falha' in e ? `erro: ${e.falha}` : summarize(e.resultado),
    })
  }
}

/** Um aviso que esgotou as tentativas, com o código curto da lista fechada de falhas de canal. */
async function avisoComFalha(prisma: PrismaClient, businessId: string, now: Date): Promise<void> {
  const cliente = await prisma.customer.findFirst({ where: { businessId }, orderBy: { createdAt: 'asc' } })
  if (!cliente) return
  const dedupeKey = 'seed:aviso-com-falha'
  await prisma.notification.upsert({
    where: { businessId_dedupeKey: { businessId, dedupeKey } },
    create: {
      businessId,
      kind: 'APPOINTMENT_REMINDER_24H',
      channel: 'EMAIL',
      customerId: cliente.id,
      scheduledFor: addMinutes(now, -120),
      status: 'FAILED',
      attempts: 3,
      lastError: 'channel_error',
      dedupeKey,
    },
    update: {},
  })
}

async function dominio() {
  const [auditoria, contexto, catalogo, equipe, horarios, bloqueios, fechamentos, clientes, agendamentos] = await Promise.all([
    import('../src/server/domain/audit'),
    import('../src/server/auth/context'),
    import('../src/server/domain/catalog/services'),
    import('../src/server/domain/team/professionals'),
    import('../src/server/domain/team/working-hours'),
    import('../src/server/domain/team/time-blocks'),
    import('../src/server/domain/settings/closures'),
    import('../src/server/domain/customers/customers'),
    import('../src/server/domain/scheduling/appointments'),
  ])
  return { ...auditoria, ...contexto, ...catalogo, ...equipe, ...horarios, ...bloqueios, ...fechamentos, ...clientes, ...agendamentos }
}

/**
 * Cria serviços, equipe, clientes, bloqueio, fechamento e agendamentos de uma conta, sempre pelas funções de
 * domínio, relativos ao "hoje" da conta. Um erro aqui (por exemplo `slot_taken`) é defeito da distribuição.
 */
async function semearAgenda(
  prisma: PrismaClient,
  conta: { chave: 'patas' | 'navalha'; agenda: DemoAgenda },
  negocio: { id: string; slug: string; name: string; timezone: string },
  adminId: string,
  now: Date,
): Promise<AgendaResumo> {
  const d = await dominio()
  const { agenda } = conta
  const tz = negocio.timezone
  const ctx = await d.createTenantContext({
    businessId: negocio.id,
    actor: { kind: 'impersonator', adminId, name: 'Seed' },
    clock: () => now,
  })

  const servicos: Awaited<ReturnType<typeof d.createService>>[] = []
  for (const s of agenda.servicos) {
    servicos.push(
      await d.createService(ctx, { name: s.nome, durationMin: s.minutos, priceCents: s.centavos, clubOnly: s.clube ?? false }),
    )
  }
  const profissionais = []
  for (const p of agenda.profissionais) {
    const vinculo = p.papel
      ? await prisma.membership.findFirstOrThrow({
          where: { businessId: negocio.id, user: { email: demoEmail(conta.chave, p.papel) } },
        })
      : null
    const criado = await d.createProfessional(ctx, {
      name: p.nome,
      commissionBps: agenda.comissaoBps,
      membershipId: vinculo?.id ?? null,
    })
    await d.setWeekSchedule(ctx, criado.id, agenda.expediente)
    profissionais.push(criado)
  }
  const clientes = []
  for (const c of agenda.clientes) {
    clientes.push(
      await d.createCustomer(ctx, {
        name: c.nome,
        phone: c.telefone,
        email: c.email ?? null,
        notes: c.notas ?? null,
        isClubMember: c.clube ?? false,
      }),
    )
  }

  const plano = planejarAgenda({
    now,
    timeZone: tz,
    expediente: agenda.expediente,
    profissionais: profissionais.map((p) => ({ id: p.id })),
    servicos: servicos.map((s, n) => ({ id: s.id, minutos: agenda.servicos[n]?.minutos ?? s.durationMin, clube: s.clubOnly })),
    clientes: clientes.map((c) => ({ id: c.id, clube: c.isClubMember })),
    combinacoes: agenda.combinacoes,
  })

  await d.createTimeBlock(ctx, {
    professionalId: plano.bloco.professionalId,
    startsAt: plano.bloco.startsAt,
    endsAt: plano.bloco.endsAt,
    reason: 'Consulta médica',
  })
  for (const m of plano.marcacoes) {
    const marcado = await d.bookAppointment(ctx, {
      customerId: m.customerId,
      professionalId: m.professionalId,
      serviceIds: m.serviceIds,
      startsAt: m.startsAt,
    })
    if (m.desfecho === 'concluir') await d.completeAppointment(ctx, marcado.id)
    else if (m.desfecho === 'faltar') await d.markNoShow(ctx, marcado.id)
    else if (m.desfecho === 'cancelar') await d.cancelAppointment(ctx, marcado.id, { reason: 'Cliente avisou que não poderá comparecer.' })
  }
  await d.createClosure(ctx, { startDate: plano.fechamento, endDate: plano.fechamento, reason: DEMO_CLOSURE_REASON })
  // Por último: o marcador de que a agenda desta conta ficou completa. O fechamento não serve, porque o
  // usuário pode apagá-lo pela tela.
  await d.audit(ctx, { action: SEED_DONE_ACTION })

  return {
    slug: negocio.slug,
    nome: negocio.name,
    servicos: servicos.length,
    profissionais: profissionais.length,
    clientes: clientes.length,
    agendamentos: plano.marcacoes.length,
  }
}

/**
 * Cria o administrador e as duas contas de demonstração. Pode rodar quantas vezes quiser:
 * o que já existe não é alterado nem duplicado, e as senhas só são gravadas na criação.
 */
export async function seed(
  prisma: PrismaClient,
  rawEnv: SeedEnv,
  /** `demoKeysFile`: onde gravar os segredos das chaves de app de demonstração; sem ele, o seed não cria chaves. */
  opts: { now?: Date; demoKeysFile?: string } = {},
): Promise<SeedResult> {
  if (rawEnv.NODE_ENV === 'production' && rawEnv.SEED_ALLOW_PRODUCTION !== '1') {
    throw new Error('O seed de demonstração não roda em produção.')
  }
  const env = lerEnv(rawEnv)
  const now = opts.now ?? new Date()
  const emails: string[] = []
  const agenda: AgendaResumo[] = []
  const semeadas: string[] = []
  const contas: { slug: string; name: string; id: string }[] = []

  const existente = await prisma.platformAdmin.findUnique({ where: { email: env.SEED_ADMIN_EMAIL } })
  const admin =
    existente ??
    (await prisma.platformAdmin.create({
      data: { name: 'Admin AgendaFlui', email: env.SEED_ADMIN_EMAIL, passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD) },
    }))
  emails.push(env.SEED_ADMIN_EMAIL)

  async function usuario(name: string, email: string): Promise<string> {
    const normalizado = emailSchema.parse(email)
    const existente = await prisma.user.findUnique({ where: { email: normalizado } })
    emails.push(normalizado)
    if (existente) {
      await prisma.user.update({ where: { id: existente.id }, data: { searchName: searchKey(name) } })
      return existente.id
    }
    const criado = await prisma.user.create({
      data: { name, searchName: searchKey(name), email: normalizado, passwordHash: await hashPassword(env.SEED_USER_PASSWORD) },
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
        searchName: searchKey(conta.nome),
        segment: conta.segmento,
        timezone: conta.fuso,
        branding: { create: { displayName: conta.nome, ...conta.marca } },
        modules: { create: conta.modulos },
        settings: { create: conta.termos },
      },
      update: { searchName: searchKey(conta.nome) },
    })
    for (const papel of ['dono', 'gerente', 'profissional'] as const) {
      const userId = await usuario(conta.equipe[papel], demoEmail(conta.chave, papel))
      await vinculo(negocio.id, userId, PAPEIS[papel])
    }
    await vinculo(negocio.id, multiId, 'OWNER')
    contas.push({ slug: negocio.slug, name: negocio.name, id: negocio.id })
    if ((await prisma.service.count({ where: { businessId: negocio.id } })) === 0) {
      agenda.push(await semearAgenda(prisma, conta, negocio, admin.id, now))
      semeadas.push(negocio.id)
    } else if (!(await prisma.auditLog.findFirst({ where: { businessId: negocio.id, action: SEED_DONE_ACTION } }))) {
      throw new SeedIncompletoError(negocio.name)
    }
  }

  // Aviso de agendamento que já terminou não faz sentido: o worker não deve achar nada pendente no passado.
  if (semeadas.length > 0) {
    await prisma.notification.updateMany({
      where: { businessId: { in: semeadas }, status: 'PENDING', appointment: { endsAt: { lte: now } } },
      data: { status: 'SKIPPED', skipReason: 'seed' },
    })
  }

  const ator: AdminAtor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  await adminInativo(prisma, ator, now)
  await contaSuspensa(prisma, ator, multiId, now)
  const patas = contas.find((c) => c.slug === 'patas-e-cia')
  if (patas) await avisoComFalha(prisma, patas.id, now)
  await execucoesDeDemonstracao(prisma, now)

  const chaves = opts.demoKeysFile
    ? await chavesDeDemonstracao(prisma, opts.demoKeysFile, admin, contas)
    : { criadas: 0, aviso: null }
  if (opts.demoKeysFile) await usoDeDemonstracao(prisma, now)
  return { emails, agenda, chaves }
}

/** Frase curta do que o seed criou na agenda de uma conta. */
export function textoDoResumo(r: AgendaResumo): string {
  return `${r.nome}: ${r.servicos} serviços, ${r.profissionais} profissionais, ${r.clientes} clientes e ${r.agendamentos} agendamentos.`
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Sem .env: valem as variáveis do ambiente.
  }
  const { prisma } = await import('../src/server/db/client')
  try {
    const arquivo = resolve('.local/demo-keys.json')
    const { emails, agenda, chaves } = await seed(prisma, process.env, { demoKeysFile: arquivo })
    console.log(`Dados de demonstração prontos. Contas de acesso: ${emails.join(', ')}.`)
    for (const r of agenda) console.log(textoDoResumo(r))
    console.log('As senhas de demonstração estão no .env.')
    if (chaves.criadas > 0) console.log(`${chaves.criadas} chaves de app de demonstração criadas; os segredos estão em .local/demo-keys.json.`)
    if (chaves.aviso) console.log(chaves.aviso)
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
