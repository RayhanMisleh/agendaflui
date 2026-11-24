import { beforeEach, describe, expect, test, vi } from 'vitest'
import { loginWithPassword } from '@/server/auth/session'
import { generateToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const quiz = vi.hoisted(() => ({ needs: vi.fn(async () => false) }))
vi.mock('@/server/auth/pet-onboarding', () => ({ needsPetQuiz: quiz.needs }))

import { assertCustomerRate, customerLandingPath, resolveStoreVisit, type CustomerVisit } from '@/server/auth/customer-access'

const SENHA = 'senha-bem-longa'
const REQ = { ip: '203.0.113.7', userAgent: 'teste' }
const AGORA = new Date('2026-11-25T15:00:00.000Z')

let a: { id: string; slug: string }
let b: { id: string; slug: string }

beforeEach(async () => {
  await resetDb()
  quiz.needs.mockReset()
  quiz.needs.mockResolvedValue(false)
  a = await makeBusiness({ slug: 'loja-a' })
  b = await makeBusiness({ slug: 'loja-b' })
})

async function entrar(userId: string, lojaLembrada: string | null = null): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const r = await loginWithPassword({ email: u.email, password: SENHA, customerBusinessId: lojaLembrada }, AGORA)
  return r.token
}

async function pessoaCliente(businessId: string) {
  const u = await makeUser({ password: SENHA })
  const c = await makeCustomer(businessId, { userId: u.id })
  return { u, c }
}

const visitar = (slug: string, token: string | undefined) => resolveStoreVisit({ token, slug, request: REQ })

describe('resolveStoreVisit', () => {
  test('sem sessão: anonymous com contexto guest da loja', async () => {
    const v = await visitar('loja-a', undefined)
    expect(v.kind).toBe('anonymous')
    if (v.kind !== 'anonymous') return
    expect(v.ctx.actor).toEqual({ kind: 'guest' })
    expect(v.ctx.businessId).toBe(a.id)
    expect(v.store.slug).toBe('loja-a')
  })

  test('pessoa cliente de A vista em B: visitor, sem customerId e sem nada de A', async () => {
    const { u } = await pessoaCliente(a.id)
    const v = await visitar('loja-b', await entrar(u.id))
    expect(v.kind).toBe('visitor')
    if (v.kind !== 'visitor') return
    expect(JSON.stringify({ store: v.store, person: v.person })).not.toContain(a.id)
    expect('customerId' in v).toBe(false)
    expect(v.kind === 'visitor' && v.ctx.actor).toEqual({ kind: 'guest' })
    expect(v.kind === 'visitor' && v.ctx.businessId).toBe(b.id)
  })

  test('sessão lembrando A (customerBusinessId) não dá acesso de cliente em B', async () => {
    const { u } = await pessoaCliente(a.id)
    const token = await entrar(u.id, a.id)
    expect((await visitar('loja-a', token)).kind).toBe('customer')
    expect((await visitar('loja-b', token)).kind).toBe('visitor')
  })

  test('cliente ativo: customer com ator customer, customerId do próprio vínculo e fuso da loja', async () => {
    await prisma.business.update({ where: { id: a.id }, data: { timezone: 'America/Manaus' } })
    const { u, c } = await pessoaCliente(a.id)
    await pessoaCliente(a.id) // outro cliente da mesma loja
    const v = await visitar('loja-a', await entrar(u.id))
    expect(v.kind).toBe('customer')
    if (v.kind !== 'customer') return
    expect(v.customerId).toBe(c.id)
    expect(v.ctx.actor).toEqual({ kind: 'customer', customerId: c.id, name: c.name })
    expect(v.ctx.timeZone).toBe('America/Manaus')
    expect(v.ctx.channel).toBe('app')
    expect(v.person).toMatchObject({ userId: u.id, email: u.email })
    expect(v.isStaff).toBe(false)
  })

  test('cliente arquivado ou anonimizado: visitor blocked', async () => {
    const x = await pessoaCliente(a.id)
    await prisma.customer.update({ where: { id: x.c.id }, data: { archivedAt: AGORA } })
    expect(await visitar('loja-a', await entrar(x.u.id))).toMatchObject({ kind: 'visitor', blocked: true })
    const y = await pessoaCliente(a.id)
    await prisma.customer.update({ where: { id: y.c.id }, data: { anonymizedAt: AGORA } })
    expect(await visitar('loja-a', await entrar(y.u.id))).toMatchObject({ kind: 'visitor', blocked: true })
  })

  test('arquivar entre duas chamadas: a segunda já é visitor blocked', async () => {
    const { u, c } = await pessoaCliente(a.id)
    const token = await entrar(u.id)
    expect((await visitar('loja-a', token)).kind).toBe('customer')
    await prisma.customer.update({ where: { id: c.id }, data: { archivedAt: AGORA } })
    expect(await visitar('loja-a', token)).toMatchObject({ kind: 'visitor', blocked: true })
  })

  test('pessoa sem vínculo: visitor sem bloqueio', async () => {
    const u = await makeUser({ password: SENHA })
    expect(await visitar('loja-a', await entrar(u.id))).toMatchObject({ kind: 'visitor', blocked: false, isStaff: false })
  })

  test('loja suspensa, inexistente ou slug reservado: unavailable', async () => {
    await makeBusiness({ slug: 'loja-parada', status: 'SUSPENDED' })
    for (const slug of ['loja-parada', 'nao-existe', 'painel', 'Loja-A', '']) {
      expect(await visitar(slug, undefined), slug).toEqual({ kind: 'unavailable' })
    }
  })

  test('sessão de suporte: anonymous', async () => {
    const admin = await makePlatformAdmin()
    const { token, hash } = generateToken()
    await prisma.session.create({ data: { impersonatorAdminId: admin.id, activeBusinessId: a.id, tokenHash: hash, expiresAt: new Date(AGORA.getTime() + 3_600_000) } })
    expect((await visitar('loja-a', token)).kind).toBe('anonymous')
  })

  test('equipe da loja que também é cliente: customer com isStaff', async () => {
    const { u } = await pessoaCliente(a.id)
    await makeMembership(a.id, u.id, 'OWNER')
    expect(await visitar('loja-a', await entrar(u.id))).toMatchObject({ kind: 'customer', isStaff: true })
  })
})

describe('assertCustomerRate', () => {
  async function visita(): Promise<CustomerVisit> {
    const { u } = await pessoaCliente(a.id)
    const v = await visitar('loja-a', await entrar(u.id))
    if (v.kind !== 'customer') throw new Error('esperava cliente')
    return v
  }

  test('booking: a 21ª em 60 s recusa com rate_limited; outro cliente não é afetado', async () => {
    const v1 = await visita()
    const v2 = await visita()
    for (let i = 0; i < 20; i++) await assertCustomerRate(v1, 'booking', AGORA)
    await expect(assertCustomerRate(v1, 'booking', AGORA)).rejects.toMatchObject({ code: 'conflict', reason: 'rate_limited', message: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.' })
    await expect(assertCustomerRate(v2, 'booking', AGORA)).resolves.toBeUndefined()
    await expect(assertCustomerRate(v1, 'order', AGORA)).resolves.toBeUndefined()
  })
})

describe('customerLandingPath', () => {
  async function visita(): Promise<CustomerVisit> {
    const { u } = await pessoaCliente(a.id)
    const v = await visitar('loja-a', await entrar(u.id))
    if (v.kind !== 'customer') throw new Error('esperava cliente')
    return v
  }

  test('loja pet sem pet ativo: quiz levando o volta', async () => {
    quiz.needs.mockResolvedValue(true)
    const v = await visita()
    expect(await customerLandingPath(v, '/loja-a/agendar')).toBe('/loja-a/boas-vindas?volta=%2Floja-a%2Fagendar')
    expect(await customerLandingPath(v, null)).toBe('/loja-a/boas-vindas')
  })

  test('com pet (ou sem nicho pet): o volta, ou a página da loja', async () => {
    const v = await visita()
    expect(await customerLandingPath(v, '/loja-a/agendar')).toBe('/loja-a/agendar')
    expect(await customerLandingPath(v, null)).toBe('/loja-a')
  })
})
