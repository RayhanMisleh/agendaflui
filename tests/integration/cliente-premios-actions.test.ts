import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { resetDb } from '../setup/db'
import { entrarComoCliente, form } from '../setup/cliente'
import { cenaFidelidade, lancar, saldoNoBanco } from '../setup/loyalty'
import { makeCustomer } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
  unstable_rethrow: (e: unknown): void => {
    if (e instanceof Error && e.message.startsWith('NEXT_')) throw e
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { cancelarResgate, resgatarPremio } from '@/app/app/[slug]/premios/actions'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

type Cena = Awaited<ReturnType<typeof montar>>
async function montar(o: { saldo?: number; custo?: number; modulo?: boolean } = {}) {
  const s = await cenaFidelidade({ modulo: o.modulo ?? true })
  const slug = (await prisma.business.findUniqueOrThrow({ where: { id: s.b.id } })).slug
  await entrarComoCliente(jar, s.b.id, s.cliente.id)
  if ((o.saldo ?? 100) > 0) await lancar(s.b.id, s.cliente.id, o.saldo ?? 100)
  const premio = o.modulo === false ? null : await createPrize(s.dono, { name: 'Corte grátis', description: null, costPoints: o.custo ?? 100, stock: null, active: true })
  return { ...s, slug, premio }
}
const resgatar = (c: Cena, campos: Record<string, string>) => resgatarPremio(c.slug, ESTADO_VAZIO, form(campos))

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

describe('resgatarPremio', () => {
  test('resgata e o saldo cai; o resgate pendente fica registrado', async () => {
    const c = await montar()
    const r = await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-1' })
    expect(r).toMatchObject({ ok: true, message: 'Resgate pedido. Retire no balcão.' })
    expect(await saldoNoBanco(c.b.id, c.cliente.id)).toBe(0)
    expect(await prisma.prizeRedemption.findMany({ where: { customerId: c.cliente.id } })).toMatchObject([{ status: 'PENDING', costPoints: 100 }])
  })

  test('custo mudou desde a tela (expectedCostPoints) → mensagem do domínio, nada muda', async () => {
    const c = await montar()
    await prisma.prize.update({ where: { id: c.premio?.id ?? '' }, data: { costPoints: 60 } })
    const r = await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-2' })
    expect(r).toMatchObject({ ok: false, message: 'O custo deste prêmio mudou. Confira o novo custo e tente de novo.' })
    expect(await saldoNoBanco(c.b.id, c.cliente.id)).toBe(100)
    expect(await prisma.prizeRedemption.count()).toBe(0)
  })

  test('saldo insuficiente → mensagem com quantos pontos faltam', async () => {
    const c = await montar({ saldo: 60 })
    const r = await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-3' })
    expect(r).toMatchObject({ ok: false, message: 'Faltam 40 pontos para este prêmio.' })
    expect(await prisma.prizeRedemption.count()).toBe(0)
  })

  test('mesma key duas vezes: um resgate só', async () => {
    const c = await montar({ saldo: 300 })
    const campos = { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-4' }
    expect((await resgatar(c, campos)).ok).toBe(true)
    expect((await resgatar(c, campos)).ok).toBe(true)
    expect(await prisma.prizeRedemption.count()).toBe(1)
    expect(await saldoNoBanco(c.b.id, c.cliente.id)).toBe(200)
  })

  test('módulo desligado → mensagem de módulo', async () => {
    const c = await montar({ modulo: false })
    const r = await resgatar(c, { prizeId: '5f0e2f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6', expectedCostPoints: '100', key: 'k-5' })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/módulo/i)
  })

  test('custo ilegível e prêmio inexistente voltam como mensagem, sem erro cru', async () => {
    const c = await montar()
    expect((await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: 'abc', key: 'k-6' })).ok).toBe(false)
    expect(await resgatar(c, { prizeId: 'nao-e-id', expectedCostPoints: '100', key: 'k-7' })).toMatchObject({ ok: false, message: 'Prêmio não encontrado.' })
  })

  test('sem sessão de cliente: vai para a entrada e nada é resgatado', async () => {
    const c = await montar()
    jar.clear()
    await expect(resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-8' })).rejects.toMatchObject({ to: `/${c.slug}/entrar?volta=${encodeURIComponent(`/${c.slug}`)}` })
    expect(await prisma.prizeRedemption.count()).toBe(0)
  })
})

describe('cancelarResgate', () => {
  test('cancela o próprio resgate e os pontos voltam', async () => {
    const c = await montar()
    await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-9' })
    const resgate = await prisma.prizeRedemption.findFirstOrThrow({ where: { customerId: c.cliente.id } })
    const r = await cancelarResgate(c.slug, ESTADO_VAZIO, form({ id: resgate.id }))
    expect(r).toMatchObject({ ok: true })
    expect(await saldoNoBanco(c.b.id, c.cliente.id)).toBe(100)
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: resgate.id } })).status).toBe('CANCELED')
  })

  test('cancelar resgate de outro cliente → não encontrado, e o resgate segue pendente', async () => {
    const c = await montar()
    const outro = await makeCustomer(c.b.id)
    await lancar(c.b.id, outro.id, 100)
    const alheio = await prisma.prizeRedemption.create({
      data: { businessId: c.b.id, customerId: outro.id, prizeId: c.premio?.id ?? '', prizeName: 'Corte grátis', costPoints: 100, stockTracked: false, status: 'PENDING', requestedByType: 'CUSTOMER', requestedById: outro.id },
    })
    const r = await cancelarResgate(c.slug, ESTADO_VAZIO, form({ id: alheio.id }))
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/não encontrado/i) })
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: alheio.id } })).status).toBe('PENDING')
  })

  test('resgate já entregue não cancela', async () => {
    const c = await montar()
    await resgatar(c, { prizeId: c.premio?.id ?? '', expectedCostPoints: '100', key: 'k-10' })
    const resgate = await prisma.prizeRedemption.findFirstOrThrow({ where: { customerId: c.cliente.id } })
    await prisma.prizeRedemption.update({ where: { id: resgate.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } })
    expect(await cancelarResgate(c.slug, ESTADO_VAZIO, form({ id: resgate.id }))).toMatchObject({ ok: false })
  })
})
