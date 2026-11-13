import { prisma } from '@/server/db/client'
import { seed, type SeedEnv } from '../../prisma/seed'
import { resetDb } from '../setup/db'

const ENV: SeedEnv = {
  SEED_ADMIN_EMAIL: 'Admin@AgendaFlui.localhost ',
  SEED_ADMIN_PASSWORD: 'senha-do-admin-demo',
  SEED_USER_PASSWORD: 'senha-dos-usuarios-demo',
  SEED_MULTI_EMAIL: ' MULTI@agendaflui.localhost',
}

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
  await seed(prisma, ENV)
  const primeira = await contagens()
  expect(primeira).toEqual({ contas: 2, marcas: 2, modulos: 2, configuracoes: 2, usuarios: 7, vinculos: 8, admins: 1 })
  await seed(prisma, ENV)
  expect(await contagens()).toEqual(primeira)
})

test('as duas contas têm as marcas, o fuso e os termos pedidos', async () => {
  await seed(prisma, ENV)
  const patas = await prisma.business.findUniqueOrThrow({
    where: { slug: 'patas-e-cia' },
    include: { branding: true, modules: true, settings: true },
  })
  expect(patas.timezone).toBe('America/Sao_Paulo')
  expect(patas.branding).toMatchObject({ primaryColor: '#2F6B4F', accentColor: '#E8833A', coverMaterial: 'LINEN', paperTone: 'CREAM', fontPair: 'FRIENDLY' })
  expect(patas.settings).toMatchObject({ termProfessionalPlural: 'Tosadores', termCustomerPlural: 'Tutores', termPointsPlural: 'Patinhas' })
  expect(patas.modules).toMatchObject({ loyalty: true, banners: true, store: false, vouchers: false })
  const navalha = await prisma.business.findUniqueOrThrow({
    where: { slug: 'navalha-de-ouro' },
    include: { branding: true, modules: true, settings: true },
  })
  expect(navalha.timezone).toBe('America/Manaus')
  expect(navalha.branding).toMatchObject({ coverMaterial: 'LEATHER', paperTone: 'WHITE', fontPair: 'CLASSIC' })
  expect(navalha.settings?.termProfessionalPlural).toBe('Barbeiros')
  expect(navalha.modules).toMatchObject({ loyalty: true, banners: true, store: true, vouchers: true })
})

test('o usuário de SEED_MULTI_EMAIL é dono das duas contas', async () => {
  await seed(prisma, ENV)
  const multi = await prisma.user.findUniqueOrThrow({
    where: { email: 'multi@agendaflui.localhost' },
    include: { memberships: { include: { business: true } } },
  })
  expect(multi.memberships.map((m) => [m.business.slug, m.role]).sort()).toEqual([
    ['navalha-de-ouro', 'OWNER'],
    ['patas-e-cia', 'OWNER'],
  ])
})

test('cada conta tem dono, gerente e profissional, e e-mails ficam normalizados', async () => {
  await seed(prisma, ENV)
  for (const slug of ['patas-e-cia', 'navalha-de-ouro']) {
    const vinculos = await prisma.membership.findMany({ where: { business: { slug } } })
    expect(vinculos.map((m) => m.role).sort()).toEqual(['MANAGER', 'OWNER', 'OWNER', 'PROFESSIONAL'])
  }
  const admin = await prisma.platformAdmin.findFirstOrThrow()
  expect(admin.email).toBe('admin@agendaflui.localhost')
  for (const u of await prisma.user.findMany()) expect(u.email).toBe(u.email.trim().toLowerCase())
})

test('nenhuma senha é gravada em texto', async () => {
  await seed(prisma, ENV)
  const hashes = [
    ...(await prisma.user.findMany()).map((u) => u.passwordHash),
    ...(await prisma.platformAdmin.findMany()).map((a) => a.passwordHash),
  ]
  expect(hashes.length).toBe(8)
  for (const h of hashes) {
    expect(h).toMatch(/^\$argon2id\$/)
    expect(h).not.toBe(ENV.SEED_USER_PASSWORD)
    expect(h).not.toBe(ENV.SEED_ADMIN_PASSWORD)
  }
})
