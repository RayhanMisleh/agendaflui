import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '@/server/db/client'
import { resolveAppKey } from '@/server/domain/platform/api-keys'
import { createTenantContext } from '@/server/auth/context'
import { listCustomers } from '@/server/domain/customers/customers'
import { getAgenda } from '@/server/domain/scheduling/agenda'
import { fitsWorkingHours, overlaps } from '@/server/domain/scheduling/slots'
import { dbDateToLocal, localParts, todayIn, weekdayOf, type Weekday } from '@/server/time'
import { DEMO_CLOSURE_REASON } from '../../prisma/seed-data'
import { diaUtil } from '../../prisma/seed-plan'
import { seed, type SeedEnv } from '../../prisma/seed'
import { resetDb } from '../setup/db'

const ENV: SeedEnv = {
  SEED_ADMIN_EMAIL: 'Admin@AgendaFlui.localhost ',
  SEED_ADMIN_PASSWORD: 'senha-do-admin-demo',
  SEED_USER_PASSWORD: 'senha-dos-usuarios-demo',
  SEED_MULTI_EMAIL: ' MULTI@agendaflui.localhost',
}

// Quarta-feira, 12:00 em São Paulo e 11:00 em Manaus.
const NOW = new Date('2026-11-18T15:00:00Z')
const SLUGS = ['patas-e-cia', 'navalha-de-ouro'] as const

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

describe('contas e acessos', () => {
  beforeEach(resetDb)

  async function contagens() {
    return {
      contas: await prisma.business.count(),
      marcas: await prisma.businessBranding.count(),
      modulos: await prisma.businessModules.count(),
      configuracoes: await prisma.businessSettings.count(),
      usuarios: await prisma.user.count(),
      vinculos: await prisma.membership.count(),
      admins: await prisma.platformAdmin.count(),
    }
  }

  test('rodar o seed duas vezes dá as mesmas contagens', async () => {
    await seed(prisma, ENV, { now: NOW })
    const primeira = await contagens()
    expect(primeira).toEqual({ contas: 3, marcas: 3, modulos: 3, configuracoes: 3, usuarios: 7, vinculos: 9, admins: 2 })
    await seed(prisma, ENV, { now: NOW })
    expect(await contagens()).toEqual(primeira)
  })

  test('as duas contas têm as marcas, o fuso e os termos pedidos', async () => {
    await seed(prisma, ENV, { now: NOW })
    const patas = await prisma.business.findUniqueOrThrow({
      where: { slug: 'patas-e-cia' },
      include: { branding: true, modules: true, settings: true },
    })
    expect(patas.timezone).toBe('America/Sao_Paulo')
    expect(patas.branding).toMatchObject({ primaryColor: '#2F7D5B', accentColor: '#F29A4B', coverMaterial: 'LEATHER', paperTone: 'CREAM', fontPair: 'FRIENDLY' })
    expect(patas.settings).toMatchObject({ termProfessionalPlural: 'Tosadores', termCustomerPlural: 'Tutores', termPointsPlural: 'Patinhas' })
    expect(patas.modules).toMatchObject({ loyalty: true, banners: true, store: false, vouchers: false })
    const navalha = await prisma.business.findUniqueOrThrow({
      where: { slug: 'navalha-de-ouro' },
      include: { branding: true, modules: true, settings: true },
    })
    expect(navalha.timezone).toBe('America/Manaus')
    expect(navalha.branding).toMatchObject({ primaryColor: '#243B6B', coverMaterial: 'WOOD', paperTone: 'WHITE', fontPair: 'MODERN' })
    expect(navalha.settings?.termProfessionalPlural).toBe('Barbeiros')
    expect(navalha.modules).toMatchObject({ loyalty: true, banners: true, store: true, vouchers: true })
  })

  test('o usuário de SEED_MULTI_EMAIL é dono das duas contas', async () => {
    await seed(prisma, ENV, { now: NOW })
    const multi = await prisma.user.findUniqueOrThrow({
      where: { email: 'multi@agendaflui.localhost' },
      include: { memberships: { include: { business: true } } },
    })
    expect(multi.memberships.map((m) => [m.business.slug, m.role]).sort()).toEqual([
      ['estudio-sol-nascente', 'OWNER'],
      ['navalha-de-ouro', 'OWNER'],
      ['patas-e-cia', 'OWNER'],
    ])
  })

  test('cada conta tem dono, gerente e profissional, e e-mails ficam normalizados', async () => {
    await seed(prisma, ENV, { now: NOW })
    for (const slug of ['patas-e-cia', 'navalha-de-ouro']) {
      const vinculos = await prisma.membership.findMany({ where: { business: { slug } } })
      expect(vinculos.map((m) => m.role).sort()).toEqual(['MANAGER', 'OWNER', 'OWNER', 'PROFESSIONAL'])
    }
    const admin = await prisma.platformAdmin.findFirstOrThrow({ where: { active: true } })
    expect(admin.email).toBe('admin@agendaflui.localhost')
    for (const u of await prisma.user.findMany()) expect(u.email).toBe(u.email.trim().toLowerCase())
  })

  test('as chaves de busca de contas e usuários são regravadas sem acento a cada execução', async () => {
    await seed(prisma, ENV, { now: NOW })
    await prisma.business.updateMany({ data: { searchName: 'Ã' } })
    await prisma.user.updateMany({ data: { searchName: 'Ã' } })
    await seed(prisma, ENV, { now: NOW })
    const { searchKey } = await import('@/server/domain/customers/contact')
    for (const b of await prisma.business.findMany()) expect(b.searchName).toBe(searchKey(b.name))
    const usuarios = await prisma.user.findMany()
    for (const u of usuarios) expect(u.searchName).toBe(searchKey(u.name))
    expect(usuarios.some((u) => u.name !== u.searchName)).toBe(true)
  })

  test('nenhuma senha é gravada em texto', async () => {
    await seed(prisma, ENV, { now: NOW })
    const hashes = [
      ...(await prisma.user.findMany()).map((u) => u.passwordHash),
      ...(await prisma.platformAdmin.findMany()).map((a) => a.passwordHash),
    ]
    expect(hashes.length).toBe(9)
    for (const h of hashes) {
      expect(h).toMatch(/^\$argon2id\$/)
      expect(h).not.toBe(ENV.SEED_USER_PASSWORD)
      expect(h).not.toBe(ENV.SEED_ADMIN_PASSWORD)
    }
  })
})

describe('dados do painel dev', () => {
  let dir: string
  let arquivo: string

  beforeEach(async () => {
    await resetDb()
    dir = await mkdtemp(join(process.cwd(), '.local', 'demo-keys-test-'))
    arquivo = join(dir, 'demo-keys.json')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function contagens() {
    return {
      admins: await prisma.platformAdmin.count(),
      contas: await prisma.business.count(),
      uso: await prisma.apiUsageHourly.count(),
      execucoes: await prisma.schedulerRun.count(),
      falhos: await prisma.notification.count({ where: { status: 'FAILED' } }),
      auditoria: await prisma.auditLog.count(),
    }
  }

  test('há um admin desativado, sem sessão e com a senha descartada', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const inativos = await prisma.platformAdmin.findMany({ where: { active: false } })
    expect(inativos).toHaveLength(1)
    expect(inativos[0]?.email).toBe('inativo@agendaflui.localhost')
    expect(inativos[0]?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await prisma.platformSession.count({ where: { adminId: inativos[0]?.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'admin.deactivated' } })).toBe(1)
  })

  test('há uma conta suspensa, auditada, e as duas de demonstração seguem ativas', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const suspensas = await prisma.business.findMany({ where: { status: 'SUSPENDED' } })
    expect(suspensas.map((b) => b.slug)).toEqual(['estudio-sol-nascente'])
    expect(await prisma.business.count({ where: { status: 'ACTIVE' } })).toBe(2)
    expect(await prisma.auditLog.count({ where: { action: 'business.status_changed' } })).toBe(1)
  })

  test('o uso da API cobre as últimas 48 horas cheias, em várias rotas, com alguns erros', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const linhas = await prisma.apiUsageHourly.findMany({ include: { apiKey: true } })
    expect(linhas.length).toBeGreaterThan(100)
    for (const l of linhas) {
      expect(l.apiKey.kind).toBe('ACCOUNT')
      expect(l.apiKey.businessId).toBe(l.businessId)
      expect(l.hour.getTime() % 3_600_000).toBe(0)
      expect(l.hour.getTime()).toBeLessThan(NOW.getTime())
      expect(l.hour.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 49 * 3_600_000)
      expect(l.errorCount).toBeLessThanOrEqual(l.count)
      expect(l.maxMs).toBeGreaterThan(0)
      expect(Number(l.totalMs)).toBeGreaterThanOrEqual(l.maxMs)
    }
    expect(new Set(linhas.map((l) => l.route)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(linhas.map((l) => l.apiKeyId)).size).toBe(2)
    expect(linhas.some((l) => l.errorCount > 0)).toBe(true)
    expect(new Set(linhas.map((l) => l.hour.getTime())).size).toBe(48)
  })

  test('há cerca de dez execuções do agendador, uma com falha e só com tipos e resumos conhecidos', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const runs = await prisma.schedulerRun.findMany()
    expect(runs.length).toBeGreaterThanOrEqual(9)
    expect(runs.length).toBeLessThanOrEqual(12)
    expect(runs.filter((r) => !r.ok)).toHaveLength(1)
    expect(runs.find((r) => !r.ok)?.summary).toMatch(/^erro: [A-Za-z]+$/)
    expect(new Set(runs.map((r) => r.kind)).size).toBe(3)
    for (const r of runs) {
      expect(r.finishedAt).not.toBeNull()
      expect(r.startedAt.getTime()).toBeLessThan(NOW.getTime())
    }
  })

  test('há um aviso FAILED com código da lista fechada', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const falhos = await prisma.notification.findMany({ where: { status: 'FAILED' } })
    expect(falhos).toHaveLength(1)
    expect(['not_configured', 'channel_error', 'timeout', 'invalid_recipient', 'internal_error']).toContain(falhos[0]?.lastError)
    expect(falhos[0]?.attempts).toBeGreaterThan(0)
  })

  test('rodar de novo não duplica nada', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const antes = await contagens()
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect(await contagens()).toEqual(antes)
    expect(antes.uso).toBeGreaterThan(0)
  })

  test('uma conta suspensa que o admin reativou não é suspensa de novo', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    await prisma.business.update({ where: { slug: 'estudio-sol-nascente' }, data: { status: 'ACTIVE' } })
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect((await prisma.business.findUniqueOrThrow({ where: { slug: 'estudio-sol-nascente' } })).status).toBe('ACTIVE')
  })

  test('conta de demonstração que ficou ativa por falha entre criar e suspender é suspensa na rodada seguinte', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    // Estado que a falha deixa: conta ativa e nenhuma auditoria de mudança de situação feita pelo admin.
    const conta = await prisma.business.findUniqueOrThrow({ where: { slug: 'estudio-sol-nascente' } })
    await prisma.business.update({ where: { id: conta.id }, data: { status: 'ACTIVE' } })
    await prisma.auditLog.deleteMany({ where: { businessId: conta.id, action: 'business.status_changed' } })
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: conta.id } })).status).toBe('SUSPENDED')
    expect(await prisma.auditLog.count({ where: { businessId: conta.id, action: 'business.status_changed', actorType: 'PLATFORM_ADMIN' } })).toBe(1)
  })

  test('sem arquivo de chaves não há uso, mas o resto existe', async () => {
    await seed(prisma, ENV, { now: NOW })
    expect(await prisma.apiUsageHourly.count()).toBe(0)
    expect(await prisma.schedulerRun.count()).toBeGreaterThan(0)
  })
})

describe('diaUtil', () => {
  const SEG_A_SAB: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  const TER_A_SAB: Weekday[] = ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

  test('um dia com expediente volta ele mesmo, nos dois sentidos', () => {
    expect(diaUtil('2026-11-18', 1, SEG_A_SAB)).toBe('2026-11-18')
    expect(diaUtil('2026-11-18', -1, SEG_A_SAB)).toBe('2026-11-18')
  })

  test('para o futuro, o domingo vai para a segunda', () => {
    expect(diaUtil('2026-11-22', 1, SEG_A_SAB)).toBe('2026-11-23')
  })

  test('para o passado, o domingo volta para o sábado', () => {
    expect(diaUtil('2026-11-22', -1, SEG_A_SAB)).toBe('2026-11-21')
  })

  test('sem expediente na segunda, a segunda anda até a terça (e volta até o sábado)', () => {
    expect(diaUtil('2026-11-23', 1, TER_A_SAB)).toBe('2026-11-24')
    expect(diaUtil('2026-11-23', -1, TER_A_SAB)).toBe('2026-11-21')
  })

  test('lista vazia é erro', () => {
    expect(() => diaUtil('2026-11-18', 1, [])).toThrow(RangeError)
  })
})

describe('agenda de demonstração', () => {
  const TAMANHO = { servicos: 5, profissionais: 3, clientes: 12, agendamentos: 23 }

  async function contaDe(slug: string) {
    return prisma.business.findUniqueOrThrow({ where: { slug } })
  }

  async function limparAgenda(businessId: string) {
    const filtro = { businessId }
    await prisma.voucherCode.deleteMany({ where: filtro })
    await prisma.payment.deleteMany({ where: filtro })
    await prisma.orderItem.deleteMany({ where: filtro })
    await prisma.order.deleteMany({ where: filtro })
    await prisma.loyaltyTransaction.deleteMany({ where: filtro })
    await prisma.prizeRedemption.deleteMany({ where: filtro })
    await prisma.voucher.deleteMany({ where: filtro })
    await prisma.partner.deleteMany({ where: filtro })
    await prisma.productImage.deleteMany({ where: filtro })
    await prisma.product.deleteMany({ where: filtro })
    await prisma.productCategory.deleteMany({ where: filtro })
    await prisma.prize.deleteMany({ where: filtro })
    await prisma.banner.deleteMany({ where: filtro })
    await prisma.businessIntegration.deleteMany({ where: filtro })
    await prisma.notification.deleteMany({ where: filtro })
    await prisma.appointmentItem.deleteMany({ where: filtro })
    await prisma.appointment.deleteMany({ where: filtro })
    await prisma.timeBlock.deleteMany({ where: filtro })
    await prisma.businessClosure.deleteMany({ where: filtro })
    await prisma.auditLog.deleteMany({ where: { businessId, action: 'seed.demo_completed' } })
    await prisma.workingHours.deleteMany({ where: filtro })
    await prisma.professionalService.deleteMany({ where: filtro })
    await prisma.professional.deleteMany({ where: filtro })
    await prisma.service.deleteMany({ where: filtro })
    await prisma.customer.deleteMany({ where: filtro })
  }

  async function agendaDaConta(slug: string) {
    const conta = await contaDe(slug)
    const agendamentos = await prisma.appointment.findMany({
      where: { businessId: conta.id },
      include: { items: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    })
    const profissionais = await prisma.professional.findMany({ where: { businessId: conta.id } })
    return { conta, agendamentos, profissionais, hoje: todayIn(conta.timezone, NOW) }
  }

  async function ctxDaConta(slug: string) {
    const conta = await contaDe(slug)
    const admin = await prisma.platformAdmin.findFirstOrThrow()
    return createTenantContext({
      businessId: conta.id,
      actor: { kind: 'impersonator', adminId: admin.id, name: 'Teste' },
      clock: () => NOW,
    })
  }

  beforeAll(async () => {
    await resetDb()
    await seed(prisma, ENV, { now: NOW })
  })

  test('cada conta tem 5 serviços, 3 profissionais, 12 clientes e 23 agendamentos', async () => {
    for (const slug of SLUGS) {
      const { id } = await contaDe(slug)
      expect({
        servicos: await prisma.service.count({ where: { businessId: id } }),
        profissionais: await prisma.professional.count({ where: { businessId: id } }),
        clientes: await prisma.customer.count({ where: { businessId: id, archivedAt: null } }),
        agendamentos: await prisma.appointment.count({ where: { businessId: id } }),
      }).toEqual(TAMANHO)
    }
  })

  test('os serviços, preços e durações são os pedidos', async () => {
    const lista = async (slug: string) =>
      (await prisma.service.findMany({ where: { business: { slug } }, orderBy: { displayOrder: 'asc' } })).map((s) => [
        s.name,
        s.durationMin,
        s.priceCents,
        s.clubOnly,
      ])
    expect(await lista('patas-e-cia')).toEqual([
      ['Banho', 60, 7000, false],
      ['Tosa higiênica', 30, 4500, false],
      ['Banho e tosa completa', 120, 14000, false],
      ['Corte de unhas', 15, 2500, false],
      ['Hidratação', 30, 5500, true],
    ])
    expect(await lista('navalha-de-ouro')).toEqual([
      ['Corte', 30, 5000, false],
      ['Barba', 30, 4000, false],
      ['Corte e barba', 60, 8000, false],
      ['Sobrancelha', 15, 2000, false],
      ['Pigmentação', 45, 9000, false],
    ])
  })

  test('dois profissionais de cada conta ficam ligados ao gerente e ao profissional, com a comissão pedida', async () => {
    for (const [slug, bps] of [
      ['patas-e-cia', 4000],
      ['navalha-de-ouro', 4500],
    ] as const) {
      const lista = await prisma.professional.findMany({
        where: { business: { slug } },
        include: { membership: { include: { user: true } } },
        orderBy: { displayOrder: 'asc' },
      })
      expect(lista).toHaveLength(3)
      expect(lista.every((p) => p.commissionBps === bps)).toBe(true)
      const ligados = lista.filter((p) => p.membership !== null)
      expect(ligados).toHaveLength(2)
      const chave = slug === 'patas-e-cia' ? 'patas' : 'navalha'
      expect(ligados.map((p) => p.membership?.user.email).sort()).toEqual([
        `gerente.${chave}@agendaflui.localhost`,
        `profissional.${chave}@agendaflui.localhost`,
      ])
    }
  })

  test('o expediente de cada conta é o pedido', async () => {
    const semana = async (slug: string) => {
      const horas = await prisma.workingHours.findMany({
        where: { business: { slug } },
        orderBy: [{ startMin: 'asc' }],
      })
      const porProfissional = new Map<string, Map<string, number[][]>>()
      for (const h of horas) {
        const dias = porProfissional.get(h.professionalId) ?? new Map<string, number[][]>()
        dias.set(h.weekday, [...(dias.get(h.weekday) ?? []), [h.startMin, h.endMin]])
        porProfissional.set(h.professionalId, dias)
      }
      return [...porProfissional.values()]
    }
    const patas = await semana('patas-e-cia')
    expect(patas).toHaveLength(3)
    for (const dias of patas) {
      expect([...dias.keys()].sort()).toEqual(['FRIDAY', 'MONDAY', 'SATURDAY', 'THURSDAY', 'TUESDAY', 'WEDNESDAY'])
      expect(dias.get('MONDAY')).toEqual([
        [480, 720],
        [780, 1080],
      ])
      expect(dias.get('SATURDAY')).toEqual([[480, 780]])
    }
    const navalha = await semana('navalha-de-ouro')
    expect(navalha).toHaveLength(3)
    for (const dias of navalha) {
      expect([...dias.keys()].sort()).toEqual(['FRIDAY', 'SATURDAY', 'THURSDAY', 'TUESDAY', 'WEDNESDAY'])
      expect(dias.get('TUESDAY')).toEqual([
        [540, 720],
        [780, 1200],
      ])
    }
  })

  test('os clientes têm telefone válido de demonstração, e-mail só em alguns e 3 no clube', async () => {
    for (const [slug, ddd] of [
      ['patas-e-cia', '5511'],
      ['navalha-de-ouro', '5592'],
    ] as const) {
      const clientes = await prisma.customer.findMany({ where: { business: { slug }, archivedAt: null } })
      expect(clientes.every((c) => c.phone?.startsWith(`${ddd}90000`) && c.phone.length === 13)).toBe(true)
      expect(new Set(clientes.map((c) => c.name)).size).toBe(12)
      const comEmail = clientes.filter((c) => c.email !== null)
      expect(comEmail.length).toBeGreaterThan(0)
      expect(comEmail.length).toBeLessThan(12)
      expect(comEmail.every((c) => c.email?.endsWith('@agendaflui.localhost'))).toBe(true)
      expect(clientes.filter((c) => c.isClubMember)).toHaveLength(3)
    }
  })

  test('cada conta tem um cliente arquivado, sem atendimentos e fora da lista padrão', async () => {
    for (const [slug, nome] of [
      ['patas-e-cia', 'Marcela Duarte'],
      ['navalha-de-ouro', 'Nelson Ferraz'],
    ] as const) {
      const conta = await contaDe(slug)
      const arquivados = await prisma.customer.findMany({ where: { businessId: conta.id, archivedAt: { not: null } } })
      expect(arquivados.map((c) => c.name)).toEqual([nome])
      expect(arquivados[0]?.anonymizedAt).toBeNull()
      expect(await prisma.appointment.count({ where: { customerId: arquivados[0]?.id } })).toBe(0)
      const ctx = await ctxDaConta(slug)
      const ativos = await listCustomers(ctx, { limit: 50 })
      expect(ativos.items).toHaveLength(12)
      expect(ativos.items.some((c) => c.name === nome)).toBe(false)
      const lista = await listCustomers(ctx, { onlyArchived: true, limit: 50 })
      expect(lista.items.map((c) => c.name)).toEqual([nome])
    }
  })

  test('6 concluídos ontem, 8 hoje, 5 amanhã, 3 na semana seguinte e 1 cancelado', async () => {
    for (const slug of SLUGS) {
      const { conta, agendamentos, hoje } = await agendaDaConta(slug)
      const dia = (a: { startsAt: Date }) => localParts(a.startsAt, conta.timezone).date
      const ativos = agendamentos.filter((a) => a.status !== 'CANCELED')
      const ontem = ativos.filter((a) => dia(a) === '2026-11-17')
      expect(hoje).toBe('2026-11-18')
      expect(ontem).toHaveLength(6)
      expect(ontem.every((a) => a.status === 'COMPLETED')).toBe(true)
      const deHoje = ativos.filter((a) => dia(a) === hoje)
      expect(deHoje).toHaveLength(8)
      const status = new Set(deHoje.map((a) => a.status))
      expect(status).toEqual(new Set(['COMPLETED', 'CONFIRMED', 'NO_SHOW']))
      expect(deHoje.filter((a) => a.status === 'NO_SHOW')).toHaveLength(1)
      for (const a of deHoje) {
        const comecou = a.startsAt.getTime() <= NOW.getTime()
        expect(comecou ? ['COMPLETED', 'NO_SHOW'] : ['CONFIRMED']).toContain(a.status)
      }
      const amanha = ativos.filter((a) => dia(a) === '2026-11-19')
      expect(amanha).toHaveLength(5)
      expect(amanha.every((a) => a.status === 'CONFIRMED')).toBe(true)
      const semana = ativos.filter((a) => dia(a) >= '2026-11-20')
      expect(semana).toHaveLength(3)
      expect(semana.every((a) => a.status === 'CONFIRMED' && dia(a) <= '2026-11-26')).toBe(true)
      const cancelados = agendamentos.filter((a) => a.status === 'CANCELED')
      expect(cancelados).toHaveLength(1)
      expect(cancelados[0]?.cancelReason).toBeTruthy()
      expect(cancelados[0] ? dia(cancelados[0]) : null).toBe('2026-11-19')
    }
  })

  test('os concluídos têm comissão e os itens guardam o preço da hora', async () => {
    const { agendamentos } = await agendaDaConta('patas-e-cia')
    const concluidos = agendamentos.filter((a) => a.status === 'COMPLETED')
    expect(concluidos.length).toBeGreaterThanOrEqual(6)
    for (const a of concluidos) {
      expect(a.commissionCents).toBe(Math.round((a.totalCents * 4000) / 10_000))
      expect(a.items.reduce((soma, i) => soma + i.priceCents, 0)).toBe(a.totalCents)
    }
  })

  test('há um bloqueio amanhã à tarde e um fechamento "Feriado" na semana seguinte', async () => {
    for (const slug of SLUGS) {
      const { conta, agendamentos } = await agendaDaConta(slug)
      const blocos = await prisma.timeBlock.findMany({ where: { businessId: conta.id } })
      expect(blocos).toHaveLength(1)
      const bloco = blocos[0]
      expect(bloco && localParts(bloco.startsAt, conta.timezone).date).toBe('2026-11-19')
      expect(bloco && Number(localParts(bloco.startsAt, conta.timezone).time.slice(0, 2))).toBeGreaterThanOrEqual(12)
      for (const a of agendamentos.filter((x) => x.status !== 'CANCELED' && x.professionalId === bloco?.professionalId)) {
        expect(bloco && overlaps({ start: a.startsAt, end: a.endsAt }, { start: bloco.startsAt, end: bloco.endsAt })).toBe(false)
      }
      const fechamentos = await prisma.businessClosure.findMany({ where: { businessId: conta.id } })
      expect(fechamentos).toHaveLength(1)
      const f = fechamentos[0]
      expect(f?.reason).toBe(DEMO_CLOSURE_REASON)
      const data = f ? dbDateToLocal(f.startDate) : ''
      expect(data >= '2026-11-20' && data <= '2026-11-26').toBe(true)
      expect(f ? dbDateToLocal(f.endDate) : '').toBe(data)
      for (const a of agendamentos) expect(localParts(a.startsAt, conta.timezone).date).not.toBe(data)
    }
  })

  test('nenhum par de agendamentos ativos do mesmo profissional se sobrepõe', async () => {
    for (const slug of SLUGS) {
      const { agendamentos } = await agendaDaConta(slug)
      const ativos = agendamentos.filter((a) => a.status !== 'CANCELED')
      for (const [i, a] of ativos.entries()) {
        for (const b of ativos.slice(i + 1)) {
          if (a.professionalId !== b.professionalId) continue
          expect(overlaps({ start: a.startsAt, end: a.endsAt }, { start: b.startsAt, end: b.endsAt })).toBe(false)
        }
      }
    }
  })

  test('todo agendamento ativo cabe no expediente do profissional', async () => {
    for (const slug of SLUGS) {
      const { conta, agendamentos } = await agendaDaConta(slug)
      const horas = await prisma.workingHours.findMany({ where: { businessId: conta.id } })
      for (const a of agendamentos.filter((x) => x.status !== 'CANCELED')) {
        const date = localParts(a.startsAt, conta.timezone).date
        const weekday = weekdayOf(date)
        const faixas = horas.filter((h) => h.professionalId === a.professionalId && h.weekday === weekday)
        expect(
          fitsWorkingHours({ start: a.startsAt, end: a.endsAt, date, timeZone: conta.timezone, workingRanges: faixas }),
        ).toBe(true)
      }
    }
  })

  test('a fila só tem lembretes pendentes de agendamentos futuros e confirmados', async () => {
    let lembretes = 0
    for (const slug of SLUGS) {
      const conta = await contaDe(slug)
      const pendentes = await prisma.notification.findMany({
        where: {
          businessId: conta.id,
          status: 'PENDING',
          kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] },
        },
        include: { appointment: true },
      })
      lembretes += pendentes.length
      for (const n of pendentes) {
        expect(n.appointment?.status).toBe('CONFIRMED')
        expect((n.appointment?.startsAt.getTime() ?? 0) > NOW.getTime()).toBe(true)
        expect(n.scheduledFor.getTime() > NOW.getTime()).toBe(true)
      }
    }
    expect(lembretes).toBeGreaterThan(0)
  })

  test('getAgenda de hoje devolve os 8 agendamentos nas colunas dos profissionais', async () => {
    for (const slug of SLUGS) {
      const ctx = await ctxDaConta(slug)
      const hoje = todayIn(ctx.timeZone, NOW)
      const [dia] = await getAgenda(ctx, { from: hoje, to: hoje })
      expect(dia?.closed).toBe(false)
      expect(dia?.professionals).toHaveLength(3)
      let total = 0
      for (const coluna of dia?.professionals ?? []) {
        expect(coluna.workingRanges.length).toBeGreaterThan(0)
        for (const a of coluna.appointments) {
          expect(a.professional.id).toBe(coluna.id)
          expect(a.local.date).toBe(hoje)
        }
        total += coluna.appointments.length
      }
      expect(total).toBe(8)
    }
  })

  test('rodar de novo não muda nada e não duplica contas nem usuários', async () => {
    const antes = {
      servicos: await prisma.service.count(),
      profissionais: await prisma.professional.count(),
      clientes: await prisma.customer.count(),
      agendamentos: await prisma.appointment.count(),
      avisos: await prisma.notification.count(),
      contas: await prisma.business.count(),
      usuarios: await prisma.user.count(),
    }
    await seed(prisma, ENV, { now: NOW })
    expect({
      servicos: await prisma.service.count(),
      profissionais: await prisma.professional.count(),
      clientes: await prisma.customer.count(),
      agendamentos: await prisma.appointment.count(),
      avisos: await prisma.notification.count(),
      contas: await prisma.business.count(),
      usuarios: await prisma.user.count(),
    }).toEqual(antes)
    expect(antes).toMatchObject({ servicos: 10, profissionais: 6, clientes: 26, agendamentos: 46 })
  })

  test('uma conta sem serviços (banco da Fase 1) recebe a agenda sem mexer na outra', async () => {
    const navalha = await contaDe('navalha-de-ouro')
    const filtro = { businessId: navalha.id }
    await limparAgenda(navalha.id)
    const usuarios = await prisma.user.count()
    const vinculos = await prisma.membership.count()

    const resultado = await seed(prisma, ENV, { now: NOW })

    expect(await prisma.business.count()).toBe(3)
    expect(await prisma.user.count()).toBe(usuarios)
    expect(await prisma.membership.count()).toBe(vinculos)
    expect(await prisma.appointment.count({ where: filtro })).toBe(23)
    expect(await prisma.service.count({ where: filtro })).toBe(5)
    expect(await prisma.appointment.count()).toBe(46)
    expect(resultado.agenda.map((r) => r.slug)).toEqual(['navalha-de-ouro'])
  })

  test('execução interrompida (só os serviços) dá erro com o nome da conta, e conta completa não faz nada', async () => {
    const navalha = await contaDe('navalha-de-ouro')
    await limparAgenda(navalha.id)
    await prisma.service.create({ data: { businessId: navalha.id, name: 'Corte', priceCents: 5000, durationMin: 30 } })
    await expect(seed(prisma, ENV, { now: NOW })).rejects.toThrow(
      'Os dados de demonstração de Navalha de Ouro ficaram incompletos. Rode npm run db:reset e inicie de novo.',
    )
    expect(await prisma.appointment.count({ where: { businessId: navalha.id } })).toBe(0)
    await limparAgenda(navalha.id)
    await seed(prisma, ENV, { now: NOW })
    expect(await prisma.appointment.count({ where: { businessId: navalha.id } })).toBe(23)
    await expect(seed(prisma, ENV, { now: NOW })).resolves.toMatchObject({ agenda: [] })
  })

  test('o marcador de conclusão é uma auditoria gravada por último, uma por conta', async () => {
    for (const slug of ['patas-e-cia', 'navalha-de-ouro']) {
      const conta = await contaDe(slug)
      const marcadores = await prisma.auditLog.findMany({ where: { businessId: conta.id, action: 'seed.demo_completed' } })
      expect(marcadores).toHaveLength(1)
      const depois = await prisma.auditLog.count({
        where: { businessId: conta.id, createdAt: { gt: marcadores[0]?.createdAt ?? new Date(0) } },
      })
      expect(depois).toBe(0)
      expect(await prisma.businessClosure.count({ where: { businessId: conta.id, reason: DEMO_CLOSURE_REASON } })).toBe(1)
    }
  })

  test('apagar o fechamento de demonstração pela tela não faz o seed seguinte falhar', async () => {
    const navalha = await contaDe('navalha-de-ouro')
    await prisma.businessClosure.deleteMany({ where: { businessId: navalha.id } })
    await expect(seed(prisma, ENV, { now: NOW })).resolves.toMatchObject({ agenda: [] })
    expect(await prisma.businessClosure.count({ where: { businessId: navalha.id } })).toBe(0)
  })

  test('com serviços e sem o marcador, o seed acusa dados incompletos', async () => {
    const navalha = await contaDe('navalha-de-ouro')
    await prisma.auditLog.deleteMany({ where: { businessId: navalha.id, action: 'seed.demo_completed' } })
    try {
      await expect(seed(prisma, ENV, { now: NOW })).rejects.toThrow('ficaram incompletos')
    } finally {
      await prisma.auditLog.create({
        data: { businessId: navalha.id, actorType: 'SYSTEM', actorName: 'Sistema', action: 'seed.demo_completed' },
      })
    }
  })

  test('o seed recusa rodar em produção, a menos que SEED_ALLOW_PRODUCTION=1', async () => {
    await expect(seed(prisma, { ...ENV, NODE_ENV: 'production' }, { now: NOW })).rejects.toThrow(
      'O seed de demonstração não roda em produção.',
    )
    await expect(seed(prisma, { ...ENV, NODE_ENV: 'production', SEED_ALLOW_PRODUCTION: '1' }, { now: NOW })).resolves.toMatchObject({
      agenda: [],
    })
  })

  test('a distribuição é a mesma para o mesmo relógio', async () => {
    const retrato = async () =>
      (await prisma.appointment.findMany({ include: { items: true, professional: true, customer: true, business: true } }))
        .map((a) => [
          a.business.slug,
          a.startsAt.toISOString(),
          a.endsAt.toISOString(),
          a.status,
          a.professional.name,
          a.customer.name,
          a.items.map((i) => i.name).sort().join('+'),
        ].join('|'))
        .sort()
    const primeiro = await retrato()
    await resetDb()
    await seed(prisma, ENV, { now: NOW })
    expect(await retrato()).toEqual(primeiro)
  })
})

describe('agenda de demonstração num domingo', () => {
  // Domingo: a barbearia (terça a sábado) e o pet shop (segunda a sábado) não abrem; "hoje" útil é adiante.
  const DOMINGO = new Date('2026-11-22T15:00:00Z')

  beforeAll(async () => {
    await resetDb()
    await seed(prisma, ENV, { now: DOMINGO })
  })

  test('cada conta tem 23 agendamentos sem sobreposição e getAgenda do dia útil traz os 8 de hoje', async () => {
    const admin = await prisma.platformAdmin.findFirstOrThrow()
    for (const [slug, hojeUtil] of [
      ['patas-e-cia', '2026-11-23'],
      ['navalha-de-ouro', '2026-11-24'],
    ] as const) {
      const conta = await prisma.business.findUniqueOrThrow({ where: { slug } })
      const agendamentos = await prisma.appointment.findMany({ where: { businessId: conta.id } })
      expect(agendamentos).toHaveLength(23)
      const ativos = agendamentos.filter((a) => a.status !== 'CANCELED')
      for (const [i, a] of ativos.entries()) {
        for (const b of ativos.slice(i + 1)) {
          if (a.professionalId === b.professionalId) {
            expect(overlaps({ start: a.startsAt, end: a.endsAt }, { start: b.startsAt, end: b.endsAt })).toBe(false)
          }
        }
      }
      const ctx = await createTenantContext({
        businessId: conta.id,
        actor: { kind: 'impersonator', adminId: admin.id, name: 'Teste' },
        clock: () => DOMINGO,
      })
      const [dia] = await getAgenda(ctx, { from: hojeUtil, to: hojeUtil })
      const doDia = (dia?.professionals ?? []).flatMap((c) => c.appointments)
      expect(doDia).toHaveLength(8)
      expect(doDia.every((a) => a.status === 'CONFIRMED')).toBe(true)
      for (const c of dia?.professionals ?? []) {
        for (const a of c.appointments) expect(a.professional.id).toBe(c.id)
      }
    }
  })
})

describe('chaves de demonstração', () => {
  let dir: string
  let arquivo: string

  beforeEach(async () => {
    await resetDb()
    dir = await mkdtemp(join(process.cwd(), '.local', 'demo-keys-test-'))
    arquivo = join(dir, 'demo-keys.json')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  const lerChaves = async () => JSON.parse(await readFile(arquivo, 'utf8')) as Record<string, string>

  test('cria uma chave por conta e uma de plataforma, com os segredos só no arquivo (modo 0600)', async () => {
    const r = await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect(r.chaves).toEqual({ criadas: 3, aviso: null })
    const chaves = await prisma.apiKey.findMany({ include: { business: true }, orderBy: { name: 'asc' } })
    expect(chaves.map((k) => [k.kind, k.business?.slug ?? null]).sort()).toEqual([
      ['ACCOUNT', 'navalha-de-ouro'],
      ['ACCOUNT', 'patas-e-cia'],
      ['PLATFORM', null],
    ])
    for (const k of chaves) expect(k.allowedOrigins.sort()).toEqual(['http://*.localhost:3000', 'http://localhost:3000'])
    const segredos = await lerChaves()
    expect(Object.keys(segredos).sort()).toEqual(['navalha-de-ouro', 'patas-e-cia', 'plataforma'])
    expect((await stat(arquivo)).mode & 0o777).toBe(0o600)
    // O banco, a auditoria e a saída não guardam nenhum segredo.
    const banco = JSON.stringify([chaves, await prisma.auditLog.findMany()])
    for (const segredo of Object.values(segredos)) expect(banco).not.toContain(segredo)
    // Cada segredo abre a conta certa.
    const patas = await resolveAppKey({ key: segredos['patas-e-cia'] ?? null, businessSlug: null })
    expect(patas.businessSlug).toBe('patas-e-cia')
    const navalha = await resolveAppKey({ key: segredos['navalha-de-ouro'] ?? null, businessSlug: null })
    expect(navalha.businessSlug).toBe('navalha-de-ouro')
    expect((await resolveAppKey({ key: segredos['plataforma'] ?? null, businessSlug: 'patas-e-cia' })).kind).toBe('PLATFORM')
  })

  test('se uma chave falha, o segredo das anteriores já está no arquivo', async () => {
    // `createApiKey` confere a conta com `findUnique({ select: { id: true } })`: depois que o arquivo existe, a próxima falha.
    const achar = prisma.business.findUnique.bind(prisma.business)
    vi.spyOn(prisma.business, 'findUnique').mockImplementation((async (args: { select?: { id?: boolean } }) => {
      if (args.select?.id === true && (await stat(arquivo).then(() => true, () => false))) throw new Error('falha simulada')
      return achar(args as never)
    }) as never)
    await expect(seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })).rejects.toThrow('falha simulada')
    expect(Object.keys(await lerChaves()).sort()).toHaveLength(1)
  })

  test('rodar de novo não cria chaves nem troca os segredos', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const antes = await readFile(arquivo, 'utf8')
    const r = await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect(r.chaves).toEqual({ criadas: 0, aviso: null })
    expect(await prisma.apiKey.count()).toBe(3)
    expect(await readFile(arquivo, 'utf8')).toBe(antes)
  })

  test('arquivo sumiu e as chaves existem: avisa em uma linha, não cria chave nova e não apaga nada', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    await rm(arquivo)
    const r = await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect(r.chaves.criadas).toBe(0)
    expect(r.chaves.aviso).toMatch(/npm run db:reset/)
    expect(r.chaves.aviso).not.toContain('\n')
    expect(await prisma.apiKey.count()).toBe(3)
    await expect(stat(arquivo)).rejects.toThrow()
  })

  test('arquivo com segredo que não é da chave do banco conta como irrecuperável', async () => {
    await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    const segredos = await lerChaves()
    await writeFile(arquivo, JSON.stringify({ ...segredos, 'patas-e-cia': 'afk_a_00000000_' + 'x'.repeat(43) }))
    const r = await seed(prisma, ENV, { now: NOW, demoKeysFile: arquivo })
    expect(r.chaves.aviso).toMatch(/npm run db:reset/)
    expect(await prisma.apiKey.count()).toBe(3)
  })

  test('sem o caminho do arquivo, o seed não cria chaves (os outros testes não tocam o .local real)', async () => {
    const r = await seed(prisma, ENV, { now: NOW })
    expect(r.chaves).toEqual({ criadas: 0, aviso: null })
    expect(await prisma.apiKey.count()).toBe(0)
  })
})

describe('avisos do seed', () => {
  beforeAll(async () => {
    await resetDb()
    await seed(prisma, ENV, { now: NOW })
  })

  test('nenhum aviso fica pendente para agendamento já terminado: viram SKIPPED com o motivo "seed"', async () => {
    const avisos = await prisma.notification.findMany({ include: { appointment: true } })
    const terminados = avisos.filter((a) => a.appointment && a.appointment.endsAt.getTime() <= NOW.getTime())
    expect(terminados.length).toBeGreaterThan(0)
    for (const a of terminados) {
      expect(a.status).toBe('SKIPPED')
      expect(a.skipReason).toBe('seed')
    }
    const futuros = avisos.filter((a) => a.appointment && a.appointment.endsAt.getTime() > NOW.getTime())
    expect(futuros.some((a) => a.status === 'PENDING')).toBe(true)
    for (const a of futuros) expect(a.skipReason).toBeNull()
  })
})

describe('módulos de demonstração', () => {
  beforeAll(async () => {
    await resetDb()
    await seed(prisma, ENV, { now: NOW })
  })

  const conta = (slug: string) => prisma.business.findUniqueOrThrow({ where: { slug } })

  test('Navalha de Ouro: catálogo da loja com 2 categorias e 5 produtos (um em promoção, um sem estoque)', async () => {
    const b = await conta('navalha-de-ouro')
    expect(await prisma.productCategory.count({ where: { businessId: b.id, archivedAt: null } })).toBe(2)
    const produtos = await prisma.product.findMany({ where: { businessId: b.id } })
    expect(produtos).toHaveLength(5)
    expect(produtos.filter((p) => p.promoPriceCents !== null)).toHaveLength(1)
    expect(produtos.filter((p) => p.stock === 0 && p.active)).toHaveLength(1)
  })

  test('Navalha de Ouro: 3 prêmios, 2 banners no ar e 1 agendado, 1 parceiro e 2 vouchers', async () => {
    const b = await conta('navalha-de-ouro')
    expect(await prisma.prize.count({ where: { businessId: b.id } })).toBe(3)
    const hoje = todayIn(b.timezone, NOW)
    const banners = await prisma.banner.findMany({ where: { businessId: b.id } })
    const noAr = banners.filter((x) => x.active && x.imageUploadId !== null && (x.startsOn === null || dbDateToLocal(x.startsOn) <= hoje) && (x.endsOn === null || dbDateToLocal(x.endsOn) >= hoje))
    const agendados = banners.filter((x) => x.active && x.startsOn !== null && dbDateToLocal(x.startsOn) > hoje)
    expect([noAr.length, agendados.length, banners.length]).toEqual([2, 1, 3])
    expect(await prisma.partner.count({ where: { businessId: b.id } })).toBe(1)
    expect(await prisma.voucher.count({ where: { businessId: b.id } })).toBe(2)
  })

  test('pontos vêm dos atendimentos concluídos (EARN com o atendimento) e o saldo de cada cliente é a soma do extrato', async () => {
    const b = await conta('navalha-de-ouro')
    const concluidos = await prisma.appointment.findMany({ where: { businessId: b.id, status: 'COMPLETED' }, include: { items: true } })
    const esperado = concluidos.reduce((t, a) => t + a.items.reduce((u, i) => u + i.rewardPoints, 0), 0)
    expect(esperado).toBeGreaterThan(0)
    const ganhos = await prisma.loyaltyTransaction.findMany({ where: { businessId: b.id, kind: 'EARN' } })
    expect(ganhos.every((g) => g.appointmentId !== null && g.createdByType !== 'SYSTEM')).toBe(true)
    expect(ganhos.reduce((t, g) => t + g.points, 0)).toBe(esperado)
    const linhas = await prisma.loyaltyTransaction.findMany({ where: { businessId: b.id } })
    const ctx = await createTenantContext({ businessId: b.id, actor: { kind: 'impersonator', adminId: (await prisma.platformAdmin.findFirstOrThrow()).id, name: 'Teste' }, clock: () => NOW })
    const { getBalance } = await import('@/server/domain/loyalty/ledger')
    for (const clienteId of new Set(linhas.map((l) => l.customerId))) {
      const soma = linhas.filter((l) => l.customerId === clienteId).reduce((t, l) => t + l.points, 0)
      expect(await getBalance(ctx.db, clienteId)).toBe(soma)
      expect(soma).toBeGreaterThanOrEqual(0)
    }
  })

  test('Navalha de Ouro: 1 resgate pendente, 1 pedido pago a entregar, 1 aguardando pagamento e 1 de vouchers com códigos', async () => {
    const b = await conta('navalha-de-ouro')
    expect(await prisma.prizeRedemption.count({ where: { businessId: b.id, status: 'PENDING' } })).toBe(1)
    const pedidos = await prisma.order.findMany({ where: { businessId: b.id }, include: { items: true }, orderBy: { number: 'asc' } })
    expect(pedidos).toHaveLength(3)
    const aEntregar = pedidos.filter((p) => p.status === 'PAID' && p.fulfillmentStatus === 'PENDING' && p.items.every((i) => i.productId !== null))
    const aguardando = pedidos.filter((p) => p.status === 'AWAITING_PAYMENT')
    const deVouchers = pedidos.filter((p) => p.items.some((i) => i.voucherId !== null))
    expect([aEntregar.length, aguardando.length, deVouchers.length]).toEqual([1, 1, 1])
    expect(deVouchers[0]?.status).toBe('PAID')
    const codigos = await prisma.voucherCode.findMany({ where: { businessId: b.id, orderId: deVouchers[0]?.id ?? '' } })
    const comprados = deVouchers[0]?.items.reduce((t, i) => t + i.quantity, 0) ?? 0
    expect(codigos.length).toBe(comprados)
    expect(codigos.every((c) => c.status === 'ACTIVE' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.code))).toBe(true)
    // Estoque reservado e pagamentos pelo caminho real.
    expect(await prisma.payment.count({ where: { businessId: b.id, status: 'APPROVED' } })).toBe(2)
  })

  test('Mercado Pago e Frenet da Navalha de Ouro ficam cifrados; nada em texto, nem na auditoria', async () => {
    const b = await conta('navalha-de-ouro')
    const i = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: b.id } })
    expect(i.mpAccessTokenEnc).not.toBeNull()
    expect(i.mpWebhookSecretEnc).not.toBeNull()
    expect(i.mpWebhookKey).not.toBeNull()
    expect(i.frenetTokenEnc).not.toBeNull()
    const todos = JSON.stringify(i)
    expect(todos).not.toContain('TEST-')
    const { getStoreIntegrations } = await import('@/server/domain/store/settings')
    const ctx = await createTenantContext({ businessId: b.id, actor: { kind: 'impersonator', adminId: (await prisma.platformAdmin.findFirstOrThrow()).id, name: 'Teste' }, clock: () => NOW })
    expect(await getStoreIntegrations(ctx)).toEqual({ mercadoPago: true, frenet: true })
    const { readMercadoPagoSecrets } = await import('@/server/domain/platform/integration-secrets')
    expect((await readMercadoPagoSecrets(b.id))?.accessToken).toMatch(/^TEST-/)
    const auditoria = JSON.stringify(await prisma.auditLog.findMany({ where: { businessId: b.id } }))
    expect(auditoria).not.toMatch(/TEST-[0-9A-Za-z]{10}/)
  })

  test('Patas & Cia: prêmios e um banner no ar, e nada de loja nem vouchers', async () => {
    const b = await conta('patas-e-cia')
    expect(await prisma.prize.count({ where: { businessId: b.id } })).toBeGreaterThanOrEqual(2)
    const hoje = todayIn(b.timezone, NOW)
    const banners = await prisma.banner.findMany({ where: { businessId: b.id, active: true } })
    expect(banners).toHaveLength(1)
    expect(banners[0]?.imageUploadId).not.toBeNull()
    const inicio = banners[0]?.startsOn ?? null
    expect(inicio === null || dbDateToLocal(inicio) <= hoje).toBe(true)
    expect(await prisma.product.count({ where: { businessId: b.id } })).toBe(0)
    expect(await prisma.order.count({ where: { businessId: b.id } })).toBe(0)
    expect(await prisma.businessIntegration.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('rodar de novo não duplica nada dos módulos', async () => {
    const contar = async () => ({
      produtos: await prisma.product.count(),
      premios: await prisma.prize.count(),
      banners: await prisma.banner.count(),
      pedidos: await prisma.order.count(),
      codigos: await prisma.voucherCode.count(),
      pontos: await prisma.loyaltyTransaction.count(),
    })
    const antes = await contar()
    await seed(prisma, ENV, { now: NOW })
    expect(await contar()).toEqual(antes)
  })
})
