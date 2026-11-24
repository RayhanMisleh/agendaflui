import { beforeAll, describe, expect, test, vi } from 'vitest'
import { criarDemo, type DemoResultado, type DemoSenhas } from '../../scripts/demo-create'
import { DEMO_CLIENTES, DEMO_EMAIL_CLIENTE_TESTE, DEMO_EMAIL_DONO } from '../../scripts/demo-data'
import { prisma } from '@/server/db/client'
import { variantOfPet } from '@/server/niches'
import { resetDb } from '../setup/db'
import { invariantesDoEncaixe } from '../setup/encaixe'

/** Terça-feira 24/11/2026, 12:00 em São Paulo: o dia seguinte (quarta) é útil e o encaixe cai no futuro. */
const AGORA = new Date('2026-11-24T15:00:00Z')
const MUITO = 600_000

let businessId: string
let primeira: DemoResultado
let senhas: DemoSenhas | null = null
const linhasDoLog: string[] = []

beforeAll(async () => {
  await resetDb()
  primeira = await criarDemo(prisma, {
    now: AGORA,
    log: (t) => linhasDoLog.push(t),
    aoCriar: (s) => {
      senhas = s
    },
  })
  businessId = (await prisma.business.findUniqueOrThrow({ where: { slug: 'demo' } })).id
}, MUITO)

describe('conta, catálogo e começo', () => {
  test('cria a demo pet: nicho PET, gatos ligados, 5 serviços BY_VARIANT com linha de gato, começo concluído', async () => {
    const conta = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { settings: true, modules: true, onboarding: true } })
    expect(conta).toMatchObject({ niche: 'PET', name: 'Focinho Feliz Pet Shop', status: 'ACTIVE' })
    expect(conta.settings?.nicheOptions).toEqual({ servesCats: true })
    expect(conta.modules).toMatchObject({ loyalty: true, banners: true, store: true })
    expect(conta.onboarding?.completedAt).not.toBeNull()
    expect(conta.onboarding?.doneSteps).toHaveLength(7)

    const servicos = await prisma.service.findMany({ where: { businessId }, include: { prices: true }, orderBy: { displayOrder: 'asc' } })
    const nomes = servicos.map((s) => s.name)
    expect(nomes).toEqual(['Banho', 'Banho e tosa', 'Tosa higiênica', 'Hidratação', 'Corte de unha', 'Limpeza de ouvidos', 'Spa relaxante'])
    for (const s of servicos.slice(0, 5)) {
      expect(s.pricingMode).toBe('BY_VARIANT')
      expect(s.prices.map((p) => p.variant).sort()).toEqual(['CAT', 'DOG_GIANT', 'DOG_LARGE', 'DOG_MEDIUM', 'DOG_SMALL'])
    }
    expect(servicos[5]).toMatchObject({ pricingMode: 'SINGLE', priceCents: 3000, durationMin: 15 })
    const spa = servicos[6]
    expect(spa).toMatchObject({ pricingMode: 'BY_VARIANT', clubOnly: true })
    expect(spa?.prices.some((p) => p.variant === 'CAT')).toBe(false)
    expect((await prisma.professionalService.count({ where: { businessId } })) > 0).toBe(true)
  })
})

describe('clientes e pets', () => {
  test('clientes com conta ligados a pessoas e clientes de balcão sem pessoa', async () => {
    const clientes = await prisma.customer.findMany({ where: { businessId }, include: { user: true } })
    expect(clientes).toHaveLength(14)
    const comConta = clientes.filter((c) => c.userId !== null)
    const balcao = clientes.filter((c) => c.userId === null)
    expect(comConta).toHaveLength(8)
    expect(balcao).toHaveLength(6)
    for (const c of comConta) {
      expect(c).toMatchObject({ origin: 'APP' })
      expect(c.linkedAt).not.toBeNull()
      expect(c.email).toBe(c.user?.email)
    }
    expect(comConta.some((c) => c.email === DEMO_EMAIL_CLIENTE_TESTE)).toBe(true)
    expect(comConta.filter((c) => c.email !== DEMO_EMAIL_CLIENTE_TESTE).every((c) => c.email?.endsWith('@clientes.demo.agendaflui.com.br'))).toBe(true)
    expect(balcao.every((c) => c.origin === 'PANEL')).toBe(true)
  })

  test('pets de todos os portes e gatos; todo agendamento tem pet do próprio cliente', async () => {
    const pets = await prisma.pet.findMany({ where: { businessId } })
    expect(new Set(pets.filter((p) => p.species === 'DOG').map((p) => p.size))).toEqual(new Set(['SMALL', 'MEDIUM', 'LARGE', 'GIANT']))
    expect(pets.filter((p) => p.species === 'CAT')).toHaveLength(3)
    expect(pets).toHaveLength(DEMO_CLIENTES.reduce((n, c) => n + c.pets.length, 0))
    const agendamentos = await prisma.appointment.findMany({ where: { businessId }, include: { pet: true } })
    expect(agendamentos.length).toBeGreaterThan(50)
    for (const a of agendamentos) {
      expect(a.petId).not.toBeNull()
      expect(a.pet?.customerId).toBe(a.customerId)
    }
  })
})

describe('agenda', () => {
  test('exatamente um encaixe futuro e as invariantes de encaixe valem', async () => {
    const encaixes = await prisma.appointment.findMany({ where: { businessId, isSqueezeIn: true } })
    expect(encaixes).toHaveLength(1)
    expect(encaixes[0]?.startsAt.getTime()).toBeGreaterThan(AGORA.getTime())
    expect(encaixes[0]?.status).toBe('CONFIRMED')
    expect(await invariantesDoEncaixe(businessId)).toEqual([])
  })

  test('nenhum item usa serviço não oferecido para a variante do pet', async () => {
    const itens = await prisma.appointmentItem.findMany({
      where: { businessId },
      include: { appointment: { include: { pet: true } }, service: { include: { prices: true } } },
    })
    expect(itens.length).toBeGreaterThan(50)
    for (const i of itens) {
      const pet = i.appointment.pet
      if (!pet) throw new Error('Agendamento sem pet.')
      const variante = variantOfPet(pet)
      expect(i.variant).toBe(variante)
      if (i.service.pricingMode === 'BY_VARIANT') expect(i.service.prices.some((p) => p.variant === variante)).toBe(true)
      expect(i.service.clubOnly ? (await prisma.customer.findUniqueOrThrow({ where: { id: i.appointment.customerId } })).isClubMember : true).toBe(true)
    }
  })
})

describe('avisos', () => {
  test('nenhum aviso fica na fila (nada foi enfileirado durante a criação) e os avisos ao cliente terminam ligados', async () => {
    expect(await prisma.notification.count({ where: { businessId, status: 'PENDING' } })).toBe(0)
    expect(await prisma.notification.count({ where: { businessId } })).toBe(0)
    const conf = await prisma.businessSettings.findUniqueOrThrow({ where: { businessId } })
    const n = conf.notifications as Record<string, { email: boolean }>
    expect(n['APPOINTMENT_CONFIRMED']?.email).toBe(true)
    expect(n['APPOINTMENT_REMINDER_24H']?.email).toBe(true)
    expect(n['STAFF_NEW_APPOINTMENT']?.email).toBe(false)
  })
})

describe('segurança e texto', () => {
  test('as senhas só saem por aoCriar: auditoria e logs não as contêm', async () => {
    expect(senhas).not.toBeNull()
    const geradas = [senhas?.dono, senhas?.cliente]
    expect(geradas.every((s) => typeof s === 'string' && s.length >= 12)).toBe(true)
    const auditoria = JSON.stringify(await prisma.auditLog.findMany({ where: { businessId } }))
    const texto = `${auditoria}\n${linhasDoLog.join('\n')}`
    for (const s of geradas) expect(texto).not.toContain(s as string)
    const dono = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL_DONO } })
    expect(dono.passwordHash).not.toContain(senhas?.dono as string)
    expect(primeira).toMatchObject({ senhaGerada: true, senhaClienteGerada: true })
  })

  test('nenhum texto da demo usa "tutor", "tosador" ou "patinhas"', async () => {
    const [servicos, profissionais, clientes, pets, banners, premios, produtos, categorias] = await Promise.all([
      prisma.service.findMany({ where: { businessId }, select: { name: true, description: true } }),
      prisma.professional.findMany({ where: { businessId }, select: { name: true, bio: true } }),
      prisma.customer.findMany({ where: { businessId }, select: { name: true, notes: true } }),
      prisma.pet.findMany({ where: { businessId }, select: { name: true, breed: true, careNotes: true } }),
      prisma.banner.findMany({ where: { businessId }, select: { title: true } }),
      prisma.prize.findMany({ where: { businessId }, select: { name: true, description: true } }),
      prisma.product.findMany({ where: { businessId }, select: { name: true, description: true } }),
      prisma.productCategory.findMany({ where: { businessId }, select: { name: true } }),
    ])
    const tudo = JSON.stringify([servicos, profissionais, clientes, pets, banners, premios, produtos, categorias])
    expect(tudo.length).toBeGreaterThan(1000)
    expect(tudo).not.toMatch(/tutor|tosador|patinhas/i)
  })
})

describe('repetir e recriar', () => {
  test('rodar de novo não duplica nada e não chama aoCriar', async () => {
    const contar = async () => ({
      clientes: await prisma.customer.count({ where: { businessId } }),
      pets: await prisma.pet.count({ where: { businessId } }),
      servicos: await prisma.service.count({ where: { businessId } }),
      agendamentos: await prisma.appointment.count({ where: { businessId } }),
      encaixes: await prisma.appointment.count({ where: { businessId, isSqueezeIn: true } }),
      pedidos: await prisma.order.count({ where: { businessId } }),
      pessoas: await prisma.user.count(),
    })
    const antes = await contar()
    const aoCriar = vi.fn()
    const r = await criarDemo(prisma, { now: AGORA, aoCriar })
    expect(aoCriar).not.toHaveBeenCalled()
    expect(r).toMatchObject({ jaExistia: true, recriada: false, senhaGerada: false })
    expect(await contar()).toEqual(antes)
  }, MUITO)

  test('recriar desliga a antiga (slug demo-antiga-…, SUSPENDED, vínculos inativos) e cria a nova com o slug demo', async () => {
    const aoCriar = vi.fn()
    const r = await criarDemo(prisma, { now: AGORA, recriar: true, aoCriar })
    expect(r).toMatchObject({ jaExistia: false, recriada: true, slug: 'demo' })
    // As pessoas já existiam: as senhas delas ficam como estão e nada é mostrado.
    expect(aoCriar).not.toHaveBeenCalled()
    expect(r).toMatchObject({ senhaGerada: false, senhaClienteGerada: false, donoJaTinhaSenha: true })

    const antiga = await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    expect(antiga.slug).toBe('demo-antiga-20261124')
    expect(antiga.status).toBe('SUSPENDED')
    expect(await prisma.membership.count({ where: { businessId, active: true } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { businessId, action: 'demo.recriada' } })).toBe(1)

    const nova = await prisma.business.findUniqueOrThrow({ where: { slug: 'demo' } })
    expect(nova.id).not.toBe(businessId)
    expect(nova.status).toBe('ACTIVE')
    expect(await prisma.customer.count({ where: { businessId: nova.id } })).toBe(14)
    expect(await prisma.membership.count({ where: { businessId: nova.id, active: true } })).toBe(5)
    expect(await prisma.appointment.count({ where: { businessId: nova.id, isSqueezeIn: true } })).toBe(1)

    // Uma segunda recriação no mesmo dia ganha o sufixo.
    await criarDemo(prisma, { now: AGORA, recriar: true })
    expect(await prisma.business.count({ where: { slug: 'demo-antiga-20261124-2' } })).toBe(1)
  }, MUITO * 2)

  test('conta com o identificador demo que não é a nossa: para sem alterar nada', async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'demo.conta_criada' } })
    await expect(criarDemo(prisma, { now: AGORA })).rejects.toThrow(/não é a de demonstração/)
  }, MUITO)
})
