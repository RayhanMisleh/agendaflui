import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { hashPassword, passwordSchema } from '../src/server/auth/password'
import type { MembershipRole, PrismaClient } from '../src/server/db/generated/client'
import { addDays, minuteToInstant, todayIn, WEEKDAYS, weekdayOf, type Weekday } from '../src/server/time'
import { DEMO_CONTAS, DEMO_MULTI_NOME, demoEmail, type DemoAgenda, type DemoPapel } from './seed-data'

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

export type SeedResult = { emails: string[]; agenda: AgendaResumo[] }

/** Primeiro dia com expediente a partir de `de` (inclusive), andando no sentido pedido (1 = futuro, -1 = passado). */
export function diaUtil(de: string, sentido: 1 | -1, diasUteis: readonly Weekday[]): string {
  let data = de
  for (let i = 0; i < 7; i += 1) {
    if (diasUteis.includes(weekdayOf(data))) return data
    data = addDays(data, sentido)
  }
  throw new RangeError('Informe ao menos um dia da semana com expediente.')
}

const GRADE_MIN = 15
const PROFISSIONAIS = 3

type Faixa = { startMin: number; endMin: number }

/** Minuto do dia que fica a `fracao` do expediente, contando só as horas de trabalho. */
function alvoNoExpediente(faixas: readonly Faixa[], fracao: number): number {
  const total = faixas.reduce((soma, f) => soma + (f.endMin - f.startMin), 0)
  let falta = Math.round((total * fracao) / GRADE_MIN) * GRADE_MIN
  for (const f of faixas) {
    const tamanho = f.endMin - f.startMin
    if (falta < tamanho) return f.startMin + falta
    falta -= tamanho
  }
  return faixas[0]?.startMin ?? 0
}

/** Primeiro início na grade, a partir do alvo, que cabe no expediente sem tocar nos horários ocupados. */
function inicioLivre(faixas: readonly Faixa[], ocupado: readonly Faixa[], duracao: number, alvo: number): number | null {
  const candidatos: number[] = []
  for (const f of faixas) {
    for (let m = Math.ceil(f.startMin / GRADE_MIN) * GRADE_MIN; m + duracao <= f.endMin; m += GRADE_MIN) {
      if (!ocupado.some((o) => m < o.endMin && o.startMin < m + duracao)) candidatos.push(m)
    }
  }
  return candidatos.find((m) => m >= alvo) ?? candidatos[0] ?? null
}

type Desfecho = 'concluir' | 'hoje' | 'confirmar' | 'cancelar'
type Marcacao = { data: string; profissional: number; fracao: number; desfecho: Desfecho }

/** Distribui `quantidade` marcações no mesmo dia, em rodízio entre os profissionais e espalhadas pelo expediente. */
function marcacoesDoDia(data: string, quantidade: number, desfecho: Desfecho): Marcacao[] {
  const rodadas = Math.ceil(quantidade / PROFISSIONAIS)
  return Array.from({ length: quantidade }, (_, i) => ({
    data,
    profissional: i % PROFISSIONAIS,
    fracao: 0.1 + Math.floor(i / PROFISSIONAIS) * (0.8 / rodadas),
    desfecho,
  }))
}

async function dominio() {
  const [contexto, catalogo, equipe, horarios, bloqueios, fechamentos, clientes, agendamentos] = await Promise.all([
    import('../src/server/auth/context'),
    import('../src/server/domain/catalog/services'),
    import('../src/server/domain/team/professionals'),
    import('../src/server/domain/team/working-hours'),
    import('../src/server/domain/team/time-blocks'),
    import('../src/server/domain/settings/closures'),
    import('../src/server/domain/customers/customers'),
    import('../src/server/domain/scheduling/appointments'),
  ])
  return { ...contexto, ...catalogo, ...equipe, ...horarios, ...bloqueios, ...fechamentos, ...clientes, ...agendamentos }
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

  const uteis = WEEKDAYS.filter((dia) => (agenda.expediente[dia]?.length ?? 0) > 0)
  const faixasDe = (data: string): Faixa[] => agenda.expediente[weekdayOf(data)] ?? []
  const hoje = todayIn(tz, now)
  const ontem = diaUtil(addDays(hoje, -1), -1, uteis)
  const diaHoje = diaUtil(hoje, 1, uteis)
  const amanha = diaUtil(addDays(hoje, 1), 1, uteis)
  const semana = Array.from({ length: 7 }, (_, i) => addDays(amanha, i + 1)).filter((dia) => uteis.includes(weekdayOf(dia)))
  const feriado = semana[1]
  const diasDaSemana = [semana[0], semana[2], semana[4]]
  if (feriado === undefined || diasDaSemana.some((dia) => dia === undefined)) {
    throw new Error('A semana seguinte não tem dias úteis suficientes para a demonstração.')
  }

  await d.createClosure(ctx, { startDate: feriado, endDate: feriado, reason: 'Feriado' })
  const ocupado = new Map<string, Faixa[]>()
  const chaveDe = (profissional: number, data: string) => `${profissional}|${data}`
  const faixasAmanha = faixasDe(amanha)
  const ultima = faixasAmanha[faixasAmanha.length - 1]
  if (!ultima) throw new Error('O dia seguinte não tem expediente.')
  const bloco = { startMin: ultima.startMin + 60, endMin: ultima.startMin + 180 }
  const donoDoBloco = profissionais[1]
  if (!donoDoBloco) throw new Error('A conta de demonstração precisa de três profissionais.')
  await d.createTimeBlock(ctx, {
    professionalId: donoDoBloco.id,
    startsAt: minuteToInstant(amanha, bloco.startMin, tz),
    endsAt: minuteToInstant(amanha, bloco.endMin, tz),
    reason: 'Consulta médica',
  })
  ocupado.set(chaveDe(1, amanha), [bloco])

  const marcacoes: Marcacao[] = [
    ...marcacoesDoDia(ontem, 6, 'concluir'),
    ...marcacoesDoDia(diaHoje, 8, 'hoje'),
    ...marcacoesDoDia(amanha, 5, 'confirmar'),
    ...[0.15, 0.45, 0.7].map((fracao, i): Marcacao => ({ data: diasDaSemana[i] ?? amanha, profissional: i, fracao, desfecho: 'confirmar' })),
    { data: amanha, profissional: 2, fracao: 0.6, desfecho: 'cancelar' },
  ]

  type Plano = Marcacao & { servicoIds: string[]; clienteId: string; profissionalId: string; minuto: number }
  const planos: Plano[] = []
  for (const [c, m] of marcacoes.entries()) {
    const cliente = clientes[(c * 5) % clientes.length]
    const combinacao = agenda.combinacoes[c % agenda.combinacoes.length] ?? [0]
    if (!cliente) throw new Error('A conta de demonstração precisa de clientes.')
    const escolhidos = combinacao
      .map((i) => ({ servico: servicos[i], demo: agenda.servicos[i] }))
      .filter((s) => s.servico && s.demo && (!s.demo.clube || cliente.isClubMember))
    const lista = escolhidos.length > 0 ? escolhidos : [{ servico: servicos[0], demo: agenda.servicos[0] }]
    const duracao = lista.reduce((soma, s) => soma + (s.demo?.minutos ?? 0), 0)
    const faixas = faixasDe(m.data)
    let achado: { profissional: number; minuto: number } | null = null
    for (let tentativa = 0; tentativa < PROFISSIONAIS && !achado; tentativa += 1) {
      const profissional = (m.profissional + tentativa) % PROFISSIONAIS
      const ja = ocupado.get(chaveDe(profissional, m.data)) ?? []
      const alvo = alvoNoExpediente(faixas, m.fracao) + profissional * GRADE_MIN
      const minuto = inicioLivre(faixas, ja, duracao, alvo)
      if (minuto !== null) achado = { profissional, minuto }
    }
    const escolhido = achado
    const dono = escolhido ? profissionais[escolhido.profissional] : undefined
    if (!escolhido || !dono) throw new Error(`Não há horário livre em ${m.data} para a demonstração.`)
    const chave = chaveDe(escolhido.profissional, m.data)
    ocupado.set(chave, [...(ocupado.get(chave) ?? []), { startMin: escolhido.minuto, endMin: escolhido.minuto + duracao }])
    planos.push({
      ...m,
      servicoIds: lista.flatMap((s) => (s.servico ? [s.servico.id] : [])),
      clienteId: cliente.id,
      profissionalId: dono.id,
      minuto: escolhido.minuto,
    })
  }

  const iniciou = (p: Plano) => p.desfecho === 'hoje' && minuteToInstant(p.data, p.minuto, tz).getTime() <= now.getTime()
  const faltou = planos.filter(iniciou).sort((a, b) => b.minuto - a.minuto)[0]
  for (const p of planos) {
    const marcado = await d.bookAppointment(ctx, {
      customerId: p.clienteId,
      professionalId: p.profissionalId,
      serviceIds: p.servicoIds,
      startsAt: minuteToInstant(p.data, p.minuto, tz),
    })
    if (p.desfecho === 'concluir' || (iniciou(p) && p !== faltou)) await d.completeAppointment(ctx, marcado.id)
    else if (p === faltou) await d.markNoShow(ctx, marcado.id)
    else if (p.desfecho === 'cancelar') await d.cancelAppointment(ctx, marcado.id, { reason: 'Cliente avisou que não poderá comparecer.' })
  }

  return {
    slug: negocio.slug,
    nome: negocio.name,
    servicos: servicos.length,
    profissionais: profissionais.length,
    clientes: clientes.length,
    agendamentos: planos.length,
  }
}

/**
 * Cria o administrador e as duas contas de demonstração. Pode rodar quantas vezes quiser:
 * o que já existe não é alterado nem duplicado, e as senhas só são gravadas na criação.
 */
export async function seed(prisma: PrismaClient, rawEnv: SeedEnv, opts: { now?: Date } = {}): Promise<SeedResult> {
  const env = lerEnv(rawEnv)
  const now = opts.now ?? new Date()
  const emails: string[] = []
  const agenda: AgendaResumo[] = []

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
    if ((await prisma.service.count({ where: { businessId: negocio.id } })) === 0) {
      agenda.push(await semearAgenda(prisma, conta, negocio, admin.id, now))
    }
  }

  return { emails, agenda }
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
    const { emails, agenda } = await seed(prisma, process.env)
    console.log(`Dados de demonstração prontos. Contas de acesso: ${emails.join(', ')}.`)
    for (const r of agenda) console.log(textoDoResumo(r))
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
