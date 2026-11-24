/**
 * `npm run demo:create`: cria (uma vez só) a conta de demonstração "Pet Shop Demonstração", com equipe, clientes, agenda de
 * 4 semanas atrás a 2 semanas à frente, fidelidade, banners e loja, com marca própria (nome, paleta, logo, símbolo e favicon). Roda em produção (`INTEGRATIONS_MODE=real`) sem
 * chamar nenhum serviço externo. Pode rodar de novo: não duplica nada, nunca troca a senha do dono, reaplica a marca da demo se estiver diferente e
 * realinha os pedidos (de uma demo antiga) pelo cliente e pelos produtos.
 *
 * Tudo passa pelas funções de domínio, exceto o que não tem função (marcado "cru" abaixo): negócio, usuários e vínculos
 * (`createBusiness` exige um admin da plataforma ativo e manda e-mail de convite), a linha de módulos e a marca, as auditorias
 * de marcação e o descarte dos avisos na fila.
 */
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { Actor, TenantContext } from '../src/server/auth/actor'
import type { PrismaClient } from '../src/server/db/generated/client'
import { hashPassword, passwordSchema } from '../src/server/auth/password'
import { searchKey } from '../src/server/domain/customers/contact'
import { hostConfigFromEnv } from '../src/server/hosts'
import { addDays, addMinutes, fromIsoInstant, minuteToInstant, todayIn } from '../src/server/time'
import { DEMO_MARCA, renderDemoBrandImages } from './demo-brand'
import {
  DEMO_BANNERS,
  DEMO_CATEGORIAS,
  DEMO_CLIENTES,
  DEMO_DONO_NOME,
  DEMO_EMAIL_DONO,
  DEMO_GERENTE,
  DEMO_NOME,
  DEMO_PEDIDOS,
  DEMO_PREMIOS,
  DEMO_PRODUTOS,
  DEMO_PROFISSIONAIS,
  DEMO_RESGATES,
  DEMO_SERVICOS,
  DEMO_SLUG,
  demoEmailEquipe,
  desfechoDe,
  DIAS_FUTURO,
  planejarAgenda,
} from './demo-data'

const ACAO_CRIADA = 'demo.conta_criada'
const ACAO_SECAO = 'demo.secao_concluida'
const ACAO_AGENDA = 'demo.agenda_iniciada'
const ACAO_MARCA = 'demo.marca_aplicada'

export type DemoResultado = {
  slug: string
  jaExistia: boolean
  /** A senha do dono foi gerada nesta rodada (e entregue a `aoCriar`, que a imprime uma vez). */
  senhaGerada: boolean
  donoJaTinhaSenha: boolean
  resumo: Record<string, number>
}

async function dominio() {
  const [contexto, clientes, servicos, profissionais, horarios, bloqueios, fechamentos, agendamentos, avisos, premios, resgates, ledger, fidelidade, banners, categorias, produtos, pedidos, pagamentos, loja, audit, marca] =
    await Promise.all([
      import('../src/server/auth/context'),
      import('../src/server/domain/customers/customers'),
      import('../src/server/domain/catalog/services'),
      import('../src/server/domain/team/professionals'),
      import('../src/server/domain/team/working-hours'),
      import('../src/server/domain/team/time-blocks'),
      import('../src/server/domain/settings/closures'),
      import('../src/server/domain/scheduling/appointments'),
      import('../src/server/domain/settings/notification-settings'),
      import('../src/server/domain/loyalty/prizes'),
      import('../src/server/domain/loyalty/redemptions'),
      import('../src/server/domain/loyalty/ledger'),
      import('../src/server/domain/loyalty/settings'),
      import('../src/server/domain/banners/banners'),
      import('../src/server/domain/store/categories'),
      import('../src/server/domain/store/products'),
      import('../src/server/domain/store/orders'),
      import('../src/server/domain/store/payments'),
      import('../src/server/domain/store/settings'),
      import('../src/server/domain/audit'),
      import('../src/server/domain/platform/brand-image'),
    ])
  return { contexto, clientes, servicos, profissionais, horarios, bloqueios, fechamentos, agendamentos, avisos, premios, resgates, ledger, fidelidade, banners, categorias, produtos, pedidos, pagamentos, loja, audit, marca }
}

/** Imagem simples (cor da marca e duas formas), sem texto: não depende de fontes do sistema. */
async function imagem(largura: number, altura: number, cor: string): Promise<{ bytes: Uint8Array }> {
  const r = Math.min(largura, altura)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
    <circle cx="${largura * 0.3}" cy="${altura * 0.55}" r="${r * 0.28}" fill="white" fill-opacity="0.35"/>
    <circle cx="${largura * 0.72}" cy="${altura * 0.4}" r="${r * 0.18}" fill="white" fill-opacity="0.25"/>
    <rect x="${largura * 0.45}" y="${altura * 0.68}" width="${largura * 0.4}" height="${altura * 0.12}" rx="${r * 0.06}" fill="white" fill-opacity="0.3"/>
  </svg>`
  const png = await sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer()
  return { bytes: new Uint8Array(png) }
}

function senhaAleatoria(): string {
  return randomBytes(18).toString('base64url')
}

/** Sorteio da hora dentro do dia local, sempre antes de `limite` (nunca no futuro). */
function antes(instante: Date, limite: Date): Date {
  return instante.getTime() > limite.getTime() ? limite : instante
}

export async function criarDemo(prisma: PrismaClient, opts: {
    now?: Date
    log?: (t: string) => void
    /** Recebe a senha do dono logo depois de a conta ser gravada (antes do resto, que é demorado e pode falhar). Nunca é guardada. */
    aoCriar?: (senha: string) => void
  } = {},): Promise<DemoResultado> {
  const now = opts.now ?? new Date()
  const log = opts.log ?? (() => undefined)
  const resumo: Record<string, number> = {}

  // ---- 1. Conta, dono e equipe (cru) ------------------------------------------------------------------------------
  let negocio = await prisma.business.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } })
  let senhaGerada = false
  let donoJaTinhaSenha = false
  const jaExistia = negocio !== null
  if (negocio) {
    const nossa = await prisma.auditLog.findFirst({ where: { businessId: negocio.id, action: ACAO_CRIADA }, select: { id: true } })
    if (!nossa) throw new Error(`Já existe uma conta com o identificador "${DEMO_SLUG}" que não é a de demonstração. Nada foi alterado.`)
  } else {
    const { outraLoja, violouUmaLoja } = await import('../src/server/domain/platform/access-core')
    const senha = senhaAleatoria()
    passwordSchema.parse(senha)
    // Cada login da equipe pertence a uma loja só: se algum e-mail da demo já é ativo em outra loja, para aqui, com a frase clara.
    const emailsDaDemo = [DEMO_EMAIL_DONO, DEMO_GERENTE.email, ...DEMO_PROFISSIONAIS.map((p) => demoEmailEquipe(p.apelido))]
    const ocupado = await prisma.membership.findFirst({ where: { active: true, user: { email: { in: emailsDaDemo } } }, select: { user: { select: { email: true } } } })
    if (ocupado) {
      throw new Error(`${outraLoja().message} O e-mail ${ocupado.user.email} já é de outra loja, então a conta de demonstração não foi criada e nada foi gravado. Desative esse acesso na outra loja e rode o comando de novo.`)
    }
    const donoExistente = await prisma.user.findUnique({ where: { email: DEMO_EMAIL_DONO }, select: { id: true, passwordHash: true } })
    const hashDono = donoExistente ? null : await hashPassword(senha)
    // Cada pessoa da equipe tem senha aleatória que ninguém conhece (não é impressa nem guardada): ninguém entra por elas.
    const equipe = [
      { nome: DEMO_GERENTE.nome, email: DEMO_GERENTE.email, papel: 'MANAGER' as const },
      ...DEMO_PROFISSIONAIS.map((p) => ({ nome: p.nome, email: demoEmailEquipe(p.apelido), papel: 'PROFESSIONAL' as const })),
    ]
    const hashesEquipe = await Promise.all(equipe.map(() => hashPassword(senhaAleatoria())))
    negocio = await prisma.$transaction(async (tx) => {
      const conta = await tx.business.create({
        data: {
          slug: DEMO_SLUG,
          name: DEMO_NOME,
          searchName: searchKey(DEMO_NOME),
          niche: 'PET',
          addressLine: 'Rua das Acácias, 120',
          city: 'São Paulo',
          state: 'SP',
          branding: { create: { displayName: DEMO_NOME, primaryColor: DEMO_MARCA.primaria, accentColor: DEMO_MARCA.destaque } },
          modules: { create: { loyalty: true, banners: true, store: true } },
          settings: { create: {} },
        },
        select: { id: true },
      })
      const donoId =
        donoExistente?.id ??
        (await tx.user.create({ data: { name: DEMO_DONO_NOME, searchName: searchKey(DEMO_DONO_NOME), email: DEMO_EMAIL_DONO, passwordHash: hashDono, emailVerifiedAt: new Date() }, select: { id: true } })).id
      await tx.membership.create({ data: { businessId: conta.id, userId: donoId, role: 'OWNER' } })
      for (const [n, pessoa] of equipe.entries()) {
        const email = pessoa.email
        const existente = await tx.user.findUnique({ where: { email }, select: { id: true } })
        const userId =
          existente?.id ??
          (await tx.user.create({ data: { name: pessoa.nome, searchName: searchKey(pessoa.nome), email, passwordHash: hashesEquipe[n] ?? null, ...(hashesEquipe[n] ? { emailVerifiedAt: new Date() } : {}) }, select: { id: true } })).id
        await tx.membership.create({ data: { businessId: conta.id, userId, role: pessoa.papel } })
      }
      await tx.auditLog.create({
        data: { businessId: conta.id, actorType: 'SYSTEM', actorName: 'Demonstração', action: ACAO_CRIADA, targetType: 'business', targetId: conta.id, metadata: {} },
      })
      return conta
    }).catch((e: unknown) => {
      // A corrida com outro convite é barrada pelo índice de um vínculo ativo por login: mesma resposta clara.
      if (violouUmaLoja(e)) throw new Error(`${outraLoja().message} A conta de demonstração não foi criada e nada foi gravado.`)
      throw e
    })
    if (donoExistente) donoJaTinhaSenha = true
    else {
      senhaGerada = true
      opts.aoCriar?.(senha)
    }
  }
  const businessId = negocio.id
  log(jaExistia ? 'Conta de demonstração já existe; conferindo o que falta.' : 'Conta criada.')

  const d = await dominio()
  // Relógio mutável: cada operação roda no instante em que ela "aconteceu".
  const relogio = { t: now }
  const clock = () => relogio.t
  const dono = await prisma.membership.findFirstOrThrow({ where: { businessId, role: 'OWNER', user: { email: DEMO_EMAIL_DONO } }, include: { user: { select: { name: true } } } })
  const atorEquipe: Actor = { kind: 'member', userId: dono.userId, membershipId: dono.id, name: dono.user.name, role: 'OWNER' }
  const ctx: TenantContext = await d.contexto.createTenantContext({ businessId, actor: atorEquipe, clock, channel: 'panel' })
  const sistema = await d.contexto.createSystemContext(businessId, clock)
  const tz = ctx.timeZone
  const hoje = todayIn(tz, now)
  const doCliente = (c: { id: string; name: string }) => d.contexto.createTenantContext({ businessId, actor: { kind: 'customer', customerId: c.id, name: c.name }, clock, channel: 'app' })

  const secaoFeita = async (secao: string) => (await prisma.auditLog.count({ where: { businessId, action: ACAO_SECAO, targetId: secao } })) > 0
  const concluirSecao = async (secao: string) => {
    await d.audit.audit(ctx, { action: ACAO_SECAO, targetType: 'demo', targetId: secao })
    log(`Seção concluída: ${secao}.`)
  }
  const secao = async (nome: string, corpo: () => Promise<void>) => {
    if (await secaoFeita(nome)) return
    relogio.t = now
    await corpo()
    relogio.t = now
    await concluirSecao(nome)
  }

  // ---- 2. Configuração (avisos) -------------------------------------------------------------------
  await secao('configuracao', async () => {
    // Avisos para a equipe usariam os e-mails fictícios da equipe: desligados. Os avisos ao cliente ficam ligados, mas os
    // clientes não têm e-mail cadastrado, então nada sai (e a fila é descartada no fim).
    await d.avisos.updateNotificationSettings(ctx, {
      STAFF_NEW_APPOINTMENT: { email: false },
      STAFF_APPOINTMENT_CANCELED: { email: false },
      STAFF_APPOINTMENT_RESCHEDULED: { email: false },
      PROFESSIONAL_FREE_EARLY: { email: false },
    })
  })

  // ---- 2b. Marca (a cada rodada) ----------------------------------------------------------------------
  // Uma demo antiga volta para o nome, a paleta e as imagens atuais; sem mudança, nada é regravado.
  {
    const imagens = await renderDemoBrandImages()
    const assinatura = createHash('sha256')
      .update(JSON.stringify(DEMO_MARCA))
      .update(imagens.logo)
      .update(imagens.symbol)
      .update(imagens.favicon)
      .digest('hex')
    const ultima = await prisma.auditLog.findFirst({ where: { businessId, action: ACAO_MARCA }, orderBy: { createdAt: 'desc' }, select: { metadata: true } })
    const gravada = ultima?.metadata && typeof ultima.metadata === 'object' && !Array.isArray(ultima.metadata) ? ultima.metadata['assinatura'] : undefined
    const atual = await prisma.businessBranding.findUniqueOrThrow({
      where: { businessId },
      select: { displayName: true, primaryColor: true, accentColor: true, logoUploadId: true, symbolUploadId: true, faviconUploadId: true },
    })
    const igual =
      atual.displayName === DEMO_MARCA.nome &&
      atual.primaryColor === DEMO_MARCA.primaria &&
      atual.accentColor === DEMO_MARCA.destaque &&
      atual.logoUploadId !== null &&
      atual.symbolUploadId !== null &&
      atual.faviconUploadId !== null
    if (!igual || gravada !== assinatura) {
      await prisma.$transaction([
        prisma.business.update({ where: { id: businessId }, data: { name: DEMO_MARCA.nome, searchName: searchKey(DEMO_MARCA.nome), version: { increment: 1 } } }),
        prisma.businessBranding.update({
          where: { businessId },
          data: { displayName: DEMO_MARCA.nome, primaryColor: DEMO_MARCA.primaria, accentColor: DEMO_MARCA.destaque, version: { increment: 1 } },
        }),
      ])
      await d.marca.replaceBrandImage(ctx, 'logo', { bytes: imagens.logo })
      await d.marca.replaceBrandImage(ctx, 'symbol', { bytes: imagens.symbol })
      await d.marca.replaceBrandImage(ctx, 'favicon', { bytes: imagens.favicon })
      await d.audit.audit(ctx, { action: ACAO_MARCA, targetType: 'demo', targetId: 'marca', metadata: { assinatura } })
      log('Marca da demonstração aplicada.')
    }
  }

  // ---- 3. Catálogo e equipe ------------------------------------------------------------------------------------
  await secao('catalogo', async () => {
    const existentes = await ctx.db.service.findMany({ select: { id: true, name: true } })
    const servicos: { id: string }[] = []
    for (const s of DEMO_SERVICOS) {
      const achado = existentes.find((e) => e.name === s.nome)
      servicos.push(
        achado ??
          (await d.servicos.createService(ctx, {
            name: s.nome,
            description: s.descricao,
            priceCents: s.centavos,
            durationMin: s.minutos,
            rewardPoints: s.pontos,
            clubOnly: 'clube' in s ? s.clube : false,
          })),
      )
    }
    const jaPro = await ctx.db.professional.findMany({ select: { name: true } })
    for (const p of DEMO_PROFISSIONAIS) {
      if (jaPro.some((x) => x.name === p.nome)) continue
      const vinculo = await prisma.membership.findFirstOrThrow({ where: { businessId, user: { email: demoEmailEquipe(p.apelido) } } })
      const criado = await d.profissionais.createProfessional(ctx, {
        name: p.nome,
        bio: p.bio,
        commissionBps: p.comissaoBps,
        membershipId: vinculo.id,
        serviceIds: p.servicos.flatMap((n) => (servicos[n] ? [servicos[n].id] : [])),
      })
      await d.horarios.setWeekSchedule(ctx, criado.id, {
        SUNDAY: [],
        MONDAY: p.expediente.MONDAY ?? [],
        TUESDAY: p.expediente.TUESDAY ?? [],
        WEDNESDAY: p.expediente.WEDNESDAY ?? [],
        THURSDAY: p.expediente.THURSDAY ?? [],
        FRIDAY: p.expediente.FRIDAY ?? [],
        SATURDAY: p.expediente.SATURDAY ?? [],
      })
    }
    resumo['serviços'] = servicos.length
  })

  // ---- 4. Clientes ---------------------------------------------------------------------------------------------
  await secao('clientes', async () => {
    const jaTem = new Set((await ctx.db.customer.findMany({ select: { name: true } })).map((c) => c.name))
    for (const [n, c] of DEMO_CLIENTES.entries()) {
      if (jaTem.has(c.nome)) continue
      await d.clientes.createCustomer(ctx, { name: c.nome, phone: `(11) 90000-${String(1000 + n)}`, email: null, notes: c.pet, isClubMember: c.clube ?? false })
    }
  })
  const clientes = await ctx.db.customer.findMany({ where: { name: { in: DEMO_CLIENTES.map((c) => c.nome) } }, select: { id: true, name: true } })
  const clientePorIdx = DEMO_CLIENTES.map((c) => {
    const achado = clientes.find((x) => x.name === c.nome)
    if (!achado) throw new Error(`Cliente de demonstração ausente: ${c.nome}.`)
    return achado
  })
  // Conta pet: um cão médio por cliente (nomes em ordem, repetindo), criado só se o cliente ainda não tem pet.
  const NOMES_PETS = ['Thor', 'Mel', 'Bob', 'Luna', 'Pipoca', 'Fred', 'Nina', 'Max']
  const petPorCliente = new Map<string, string>()
  if ((await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { niche: true } })).niche === 'PET') {
    for (const [n, cliente] of clientePorIdx.entries()) {
      const nome = NOMES_PETS[n % NOMES_PETS.length] ?? 'Thor'
      const existente = await prisma.pet.findFirst({ where: { businessId, customerId: cliente.id, archivedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      const pet = existente ?? (await prisma.pet.create({ data: { businessId, customerId: cliente.id, name: nome, searchName: searchKey(nome), species: 'DOG', size: 'MEDIUM' }, select: { id: true } }))
      petPorCliente.set(cliente.id, pet.id)
    }
  }
  const profissionais = DEMO_PROFISSIONAIS.map((p) => p.nome)
  const profRows = await ctx.db.professional.findMany({ where: { name: { in: profissionais } }, select: { id: true, name: true } })
  const profPorIdx = DEMO_PROFISSIONAIS.map((p) => {
    const achado = profRows.find((x) => x.name === p.nome)
    if (!achado) throw new Error(`Profissional de demonstração ausente: ${p.nome}.`)
    return achado
  })
  const servRows = await ctx.db.service.findMany({ where: { name: { in: DEMO_SERVICOS.map((s) => s.nome) } }, select: { id: true, name: true } })
  const servPorIdx = DEMO_SERVICOS.map((s) => servRows.find((x) => x.name === s.nome)?.id ?? '')

  // ---- 5. Agenda -----------------------------------------------------------------------------------------------
  // Roda em toda rodada: estende o plano até hoje + 14 dias e liquida o que já ficou no passado (só acrescenta).
  {
    // A âncora fica registrada na primeira rodada: uma rodada retomada refaz exatamente o mesmo plano.
    const inicio = await prisma.auditLog.findFirst({ where: { businessId, action: ACAO_AGENDA }, select: { metadata: true } })
    const gravada = inicio?.metadata && typeof inicio.metadata === 'object' && !Array.isArray(inicio.metadata) ? inicio.metadata['ancora'] : undefined
    const ancora = typeof gravada === 'string' ? gravada : hoje
    if (!inicio) await d.audit.audit(ctx, { action: ACAO_AGENDA, targetType: 'demo', targetId: 'agenda', metadata: { ancora } })

    // Um feriado à frente e dois bloqueios de horário.
    let feriado = addDays(ancora, 10)
    const fechamentos = await d.fechamentos.listClosures(ctx, {})
    const jaFechado = fechamentos.find((f) => f.reason === 'Feriado (demonstração)')
    if (jaFechado) feriado = jaFechado.startDate
    else await d.fechamentos.createClosure(ctx, { startDate: feriado, endDate: feriado, reason: 'Feriado (demonstração)' })
    const bloqueiosPlano = [
      { profissional: 2, data: addDays(ancora, 3), startMin: 840, endMin: 960, motivo: 'Consulta médica' },
      { profissional: 0, data: addDays(ancora, -10), startMin: 840, endMin: 1020, motivo: 'Curso de tosa' },
    ]
    for (const b of bloqueiosPlano) {
      const startsAt = minuteToInstant(b.data, b.startMin, tz)
      const dono = profPorIdx[b.profissional]
      if (!dono) continue
      const ja = await ctx.db.timeBlock.findFirst({ where: { professionalId: dono.id, startsAt } })
      if (!ja) await d.bloqueios.createTimeBlock(ctx, { professionalId: dono.id, startsAt, endsAt: minuteToInstant(b.data, b.endMin, tz), reason: b.motivo })
    }

    const plano = planejarAgenda({ ancora, fuso: tz, fechados: [feriado], bloqueios: bloqueiosPlano, ate: addDays(hoje, DIAS_FUTURO), clubeDosClientes: DEMO_CLIENTES.map((c) => c.clube === true) })
    const existentes = await ctx.db.appointment.findMany({ select: { id: true, status: true, professionalId: true, startsAt: true } })
    const porChave = new Map(existentes.map((a) => [`${a.professionalId}|${String(a.startsAt.getTime())}`, a]))
    let n = 0
    for (const m of plano) {
      const prof = profPorIdx[m.profissional]
      const cliente = clientePorIdx[m.cliente]
      if (!prof || !cliente) continue
      let ag: { id: string; status: string } | undefined = porChave.get(`${prof.id}|${String(m.startsAt.getTime())}`)
      if (!ag) {
        relogio.t = now
        const marcado = await d.agendamentos.bookAppointment(ctx, {
          customerId: cliente.id,
          ...(petPorCliente.has(cliente.id) ? { petId: petPorCliente.get(cliente.id) ?? null } : {}),
          professionalId: prof.id,
          serviceIds: m.servicos.map((i) => servPorIdx[i] ?? ''),
          startsAt: m.startsAt,
        })
        ag = { id: marcado.id, status: 'CONFIRMED' }
      }
      const desfecho = desfechoDe(m, now)
      if (ag.status === 'CONFIRMED' || ag.status === 'PENDING') {
        if (desfecho === 'concluir') {
          relogio.t = antes(m.endsAt, now)
          await d.agendamentos.completeAppointment(ctx, ag.id)
        } else if (desfecho === 'faltar') {
          relogio.t = antes(addMinutes(m.startsAt, 15), now)
          await d.agendamentos.markNoShow(ctx, ag.id)
        } else if (desfecho === 'cancelar') {
          relogio.t = antes(addMinutes(m.startsAt, -180), now)
          await d.agendamentos.cancelAppointment(ctx, ag.id, { reason: n % 2 === 0 ? 'Cliente avisou que não poderá comparecer.' : 'Pet com sinais de resfriado; remarcar depois.' })
        }
      }
      n += 1
    }
    relogio.t = now
  }

  // ---- 6. Fidelidade ------------------------------------------------------------------------------------------
  await secao('fidelidade', async () => {
    const existentes = await ctx.db.prize.findMany({ select: { id: true, name: true } })
    const premios: { id: string; costPoints: number }[] = []
    for (const p of DEMO_PREMIOS) {
      const achado = existentes.find((e) => e.name === p.nome)
      premios.push(achado ? { id: achado.id, costPoints: p.pontos } : await d.premios.createPrize(ctx, { name: p.nome, description: p.descricao, costPoints: p.pontos, stock: p.estoque, active: true }))
    }
    const cfg = await d.fidelidade.getLoyaltySettings(ctx)
    if (!cfg.rankingEnabled) await d.fidelidade.updateLoyaltySettings(ctx, cfg.version, { rankingEnabled: true })

    // Quem mais pontuou resgata primeiro; se faltar saldo, a equipe soma o que falta (pela função de domínio).
    const saldos = await ctx.db.loyaltyTransaction.groupBy({ by: ['customerId'], _sum: { points: true } })
    const ordem = [...saldos].sort((a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0)).map((s) => s.customerId)
    const jaResgatado = await ctx.db.prizeRedemption.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, status: true, customerId: true } })
    for (const [k, r] of DEMO_RESGATES.entries()) {
      const premio = premios[r.premio]
      if (!premio) continue
      relogio.t = antes(minuteToInstant(addDays(hoje, -r.diasAtras), 600 + k * 17, tz), now)
      let resgate = jaResgatado[k]
      if (!resgate) {
        const clienteId = ordem[k] ?? clientePorIdx[k]?.id
        if (!clienteId) continue
        const saldo = await d.ledger.getBalance(ctx.db, clienteId)
        if (saldo < premio.costPoints) await d.ledger.adjustPoints(ctx, { customerId: clienteId, points: premio.costPoints - saldo, reason: 'Bônus de boas-vindas (demonstração)' })
        const feito = await d.resgates.redeemPrize(ctx, { prizeId: premio.id, customerId: clienteId })
        resgate = { id: feito.redemption.id, status: 'PENDING', customerId: clienteId }
      }
      if (resgate.status === 'PENDING' && r.fim === 'entregue') await d.resgates.deliverRedemption(ctx, resgate.id)
      if (resgate.status === 'PENDING' && r.fim === 'cancelado') await d.resgates.cancelRedemption(ctx, resgate.id, { reason: 'Cliente desistiu do prêmio.' })
    }
  })

  // ---- 7. Banners ---------------------------------------------------------------------------------------------
  await secao('banners', async () => {
    const existentes = await ctx.db.banner.findMany({ select: { title: true } })
    for (const b of DEMO_BANNERS) {
      if (existentes.some((e) => e.title === b.titulo)) continue
      const criado = await d.banners.createBanner(ctx, {
        title: b.titulo,
        linkUrl: b.link,
        startsOn: b.inicio === null ? null : addDays(hoje, b.inicio),
        endsOn: b.fim === null ? null : addDays(hoje, b.fim),
        active: false,
      })
      await d.banners.setBannerImage(ctx, criado.id, await imagem(1200, 500, b.cor))
      await d.banners.updateBanner(ctx, criado.id, { active: true })
    }
  })

  // ---- 8. Loja -------------------------------------------------------------------------------------
  await secao('loja', async () => {
    // Só retirada no balcão: sem entrega não há CEP, frete nem Frenet. Sem Mercado Pago configurado na conta.
    const cfgLoja = await d.loja.getStoreSettings(ctx)
    if (cfgLoja.pickupInstructions === null) {
      await d.loja.updateStoreSettings(ctx, cfgLoja.version, {
        pickupEnabled: true,
        pickupInstructions: 'Retire no balcão do pet shop, de segunda a sábado, em horário comercial.',
        shippingEnabled: false,
        originPostalCode: null,
        defaultPackage: cfgLoja.defaultPackage,
        paymentWindowMin: cfgLoja.paymentWindowMin,
      })
    }
    const cats = await ctx.db.productCategory.findMany({ select: { id: true, name: true } })
    const categorias: { id: string }[] = []
    for (const nome of DEMO_CATEGORIAS) categorias.push(cats.find((c) => c.name === nome) ?? (await d.categorias.createCategory(ctx, { name: nome })))
    const prods = await ctx.db.product.findMany({ select: { id: true, name: true } })
    for (const p of DEMO_PRODUTOS) {
      if (prods.some((x) => x.name === p.nome)) continue
      const criado = await d.produtos.createProduct(ctx, {
        categoryId: categorias[p.categoria]?.id ?? null,
        name: p.nome,
        description: p.descricao,
        priceCents: p.centavos,
        promoPriceCents: p.promocao ?? null,
        stock: p.estoque,
        weightGrams: p.gramas,
        lengthCm: null,
        heightCm: null,
        widthCm: null,
        active: true,
      })
      await d.produtos.addProductImage(ctx, criado.id, await imagem(800, 800, p.cor))
    }
  })

  // ---- 9. Pedidos ---------------------------------------------------------------------------------------------
  // Pagamento: `createOrder` não chama provedor nenhum; o pagamento aprovado entra por `applyPayment`, o mesmo caminho do
  // webhook, com o pagamento montado aqui (como a consulta ao Mercado Pago o devolveria). Nenhum `integrations()` é usado.
  // Roda em toda rodada e casa cada pedido do plano com o que já existe pelo cliente e pelos itens (não pela posição): uma
  // demo antiga, de quando havia outro tipo de pedido, se realinha, e só o que falta é criado.
  {
    const prods = await ctx.db.product.findMany({ select: { id: true, name: true } })
    const existentes = await ctx.db.order.findMany({
      orderBy: { number: 'asc' },
      select: { id: true, customerId: true, status: true, fulfillmentStatus: true, totalCents: true, items: { select: { productId: true, quantity: true } } },
    })
    const assinaturaDeItens = (itens: { productId: string | null; quantity: number }[]): string =>
      itens.map((i) => `${i.productId ?? '-'}x${String(i.quantity)}`).sort().join(',')
    const usados = new Set<string>()
    for (const p of DEMO_PEDIDOS) {
      relogio.t = antes(minuteToInstant(addDays(hoje, -p.diasAtras), p.minuto, tz), now)
      const cliente = clientePorIdx[p.cliente]
      if (!cliente) continue
      const linhas = p.linhas.map((l) => ({ productId: prods.find((x) => x.name === DEMO_PRODUTOS[l.produto]?.nome)?.id ?? '', quantity: l.qtd }))
      const quero = assinaturaDeItens(linhas)
      let pedido: { id: string; status: string; fulfillmentStatus: string; totalCents: number } | undefined = existentes.find(
        (o) => !usados.has(o.id) && o.customerId === cliente.id && assinaturaDeItens(o.items) === quero,
      )
      if (pedido) usados.add(pedido.id)
      if (!pedido) {
        const criado = await d.pedidos.createOrder(await doCliente(cliente), { lines: linhas, delivery: { method: 'PICKUP' }, note: null })
        pedido = { id: criado.order.id, status: 'AWAITING_PAYMENT', fulfillmentStatus: 'PENDING', totalCents: criado.order.totalCents }
        usados.add(pedido.id)
      }
      if (p.fim === 'cancelado') {
        if (pedido.status === 'AWAITING_PAYMENT') await d.pedidos.cancelOrder(await doCliente(cliente), pedido.id, { reason: 'Mudei de ideia.' })
        continue
      }
      if (pedido.status === 'AWAITING_PAYMENT') {
        relogio.t = antes(addMinutes(relogio.t, 10), now)
        await d.pagamentos.applyPayment(sistema, pedido.id, {
          id: `demo-${pedido.id}`,
          status: 'approved',
          statusDetail: 'accredited',
          amountCents: pedido.totalCents,
          currency: 'BRL',
          externalReference: pedido.id,
          approvedAt: relogio.t,
        })
        pedido = { ...pedido, status: 'PAID' }
      }
      if (pedido.status !== 'PAID') continue
      relogio.t = antes(addMinutes(relogio.t, 60), now)
      if (p.fim === 'cancelado_pago') {
        await d.pedidos.cancelOrder(ctx, pedido.id, { reason: 'Cliente desistiu da compra.' })
      } else if (p.fim === 'entregue') {
        if (pedido.fulfillmentStatus === 'PENDING') await d.pedidos.advanceFulfillment(ctx, pedido.id, { to: 'READY_FOR_PICKUP' })
        if (pedido.fulfillmentStatus !== 'DELIVERED') await d.pedidos.advanceFulfillment(ctx, pedido.id, { to: 'DELIVERED' })
      } else if (p.fim === 'pronto' && pedido.fulfillmentStatus === 'PENDING') {
        await d.pedidos.advanceFulfillment(ctx, pedido.id, { to: 'READY_FOR_PICKUP' })
      }
    }
    relogio.t = now
  }

  // ---- 10. Fila de avisos (cru) ---------------------------------------------------------------------------------
  // As marcações e pedidos enfileiraram avisos aos clientes (sem e-mail nem aparelho): nenhum deve tentar sair.
  await prisma.notification.updateMany({ where: { businessId, status: 'PENDING' }, data: { status: 'SKIPPED', skipReason: 'demonstracao' } })

  const contar = async () => {
    resumo['clientes'] = await ctx.db.customer.count()
    resumo['agendamentos'] = await ctx.db.appointment.count()
    resumo['pedidos'] = await ctx.db.order.count()
    resumo['produtos'] = await ctx.db.product.count()
  }
  await contar()
  return { slug: DEMO_SLUG, jaExistia, senhaGerada, donoJaTinhaSenha, resumo }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Sem .env: valem as variáveis do ambiente.
  }
  const { prisma } = await import('../src/server/db/client')
  try {
    // Só para teste local: simula outra data de hoje. Recusado em produção.
    const simulada = process.env['DEMO_NOW']
    if (simulada && process.env['NODE_ENV'] === 'production') throw new Error('DEMO_NOW não vale em produção.')
    const now = simulada ? fromIsoInstant(simulada) : undefined
    const { app } = hostConfigFromEnv(process.env)
    const esquema = process.env['NODE_ENV'] === 'production' ? 'https' : 'http'
    const link = `${esquema}://${app}/entrar`
    // Depois do `.env`: o módulo lê o ambiente ao ser carregado.
    const { customerLinkUrl } = await import('../src/server/customer-link')
    const linkClientes = customerLinkUrl(DEMO_SLUG)
    const r = await criarDemo(prisma, {
      ...(now ? { now } : {}),
      log: (t) => console.log(t),
      aoCriar: (senha) => {
        console.log('')
        console.log(`E-mail de acesso: ${DEMO_EMAIL_DONO}`)
        console.log(`Link de entrada: ${link}`)
        console.log(`Link para clientes: ${linkClientes}`)
        console.log(`Senha (aparece só desta vez; anote agora): ${senha}`)
        console.log('')
      },
    })
    console.log('')
    console.log(`Conta de demonstração: ${r.slug}`)
    console.log(`E-mail de acesso: ${DEMO_EMAIL_DONO}`)
    console.log(`Link de entrada: ${link}`)
    console.log(`Link para clientes: ${linkClientes}`)
    if (r.senhaGerada) {
      console.log('A senha foi mostrada acima, uma única vez.')
    } else if (r.donoJaTinhaSenha) {
      console.log('O e-mail do dono já era de um usuário existente: a senha dele não foi alterada.')
    } else {
      console.log('A conta já existia: a senha não foi alterada. Para trocá-la, use a redefinição de senha do painel.')
    }
    console.log(`Resumo: ${Object.entries(r.resumo).map(([k, v]) => `${String(v)} ${k}`).join(', ')}.`)
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
