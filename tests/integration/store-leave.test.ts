import { beforeEach, describe, expect, test } from 'vitest'
import { DELETE_CONFIRM_WORD, deleteStoreAccount } from '@/server/auth/store-leave'
import { getPersonSession, loginWithPassword } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeAppointment, makeBusiness, makeCustomer, makeMembership, makeProfessional, makeService, makeUser } from '../setup/factories'
import { cenaLoja, produto } from '../setup/store'
import { marcarPago, pedidoComRetirada } from '../setup/store-orders'

const SENHA = 'senha-bem-longa'
const AGORA = new Date('2026-11-17T15:00:00Z')

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

async function entrar(userId: string, lojaLembrada: string | null = null): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  return (await loginWithPassword({ email: u.email, password: SENHA, customerBusinessId: lojaLembrada }, AGORA)).token
}

const sair = (i: { userId: string; businessId: string; customerId: string; token: string; password?: string; confirm?: string }) =>
  deleteStoreAccount({ userId: i.userId, businessId: i.businessId, customerId: i.customerId, sessionToken: i.token, ...(i.password !== undefined ? { password: i.password } : {}), ...(i.confirm !== undefined ? { confirm: i.confirm } : {}) }, {}, AGORA)

describe('deleteStoreAccount', () => {
  test('cliente de uma loja só, com senha: anonimiza, apaga a pessoa e derruba as sessões', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ password: SENHA })
    const c = await makeCustomer(b.id, { userId: u.id })
    const token = await entrar(u.id, b.id)
    await prisma.emailCode.create({ data: { purpose: 'EMAIL_CHANGE', subject: u.id, email: 'novo@exemplo.test', codeHash: 'x', expiresAt: addMinutes(AGORA, 10) } })
    const r = await sair({ userId: u.id, businessId: b.id, customerId: c.id, token, password: SENHA })
    expect(r).toEqual({ personDeleted: true, nextPath: '/entrar?conta=excluida' })
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(0)
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0)
    expect(await getPersonSession(token, AGORA)).toBeNull()
    expect(await prisma.emailCode.count({ where: { subject: u.id } })).toBe(0)
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois).toMatchObject({ userId: null, email: null, phone: null, name: 'Cliente removido' })
    expect(depois.anonymizedAt).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'customer.account_deleted_by_customer' } })).toBe(1)
  })

  test('cliente de duas lojas: anonimiza só nesta; a pessoa fica e entra na outra loja', async () => {
    const a = await makeBusiness({ slug: 'loja-a' })
    const b = await makeBusiness({ slug: 'loja-b' })
    const u = await makeUser({ password: SENHA })
    const ca = await makeCustomer(a.id, { userId: u.id })
    const cb = await makeCustomer(b.id, { userId: u.id })
    const token = await entrar(u.id, a.id)
    const r = await sair({ userId: u.id, businessId: a.id, customerId: ca.id, token, password: SENHA })
    expect(r).toEqual({ personDeleted: false, nextPath: '/loja-b' })
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ca.id } })).anonymizedAt).not.toBeNull()
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: cb.id } })).toMatchObject({ anonymizedAt: null, userId: u.id })
    const sessao = await getPersonSession(token, AGORA)
    expect(sessao).toMatchObject({ kind: 'person', customerBusinessId: null })
  })

  test('pessoa que é da equipe (mesmo inativa) não é apagada', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ password: SENHA })
    const c = await makeCustomer(b.id, { userId: u.id })
    await prisma.membership.update({ where: { id: (await makeMembership(b.id, u.id, 'OWNER')).id }, data: { active: false } })
    const token = await entrar(u.id, b.id)
    const r = await sair({ userId: u.id, businessId: b.id, customerId: c.id, token, password: SENHA })
    expect(r.personDeleted).toBe(false)
    expect(r.nextPath).toBe('/')
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1)
  })

  test('senha errada: nada muda', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ password: SENHA })
    const c = await makeCustomer(b.id, { userId: u.id })
    const token = await entrar(u.id, b.id)
    await expect(sair({ userId: u.id, businessId: b.id, customerId: c.id, token, password: 'errada-errada' })).rejects.toMatchObject({ fields: { password: 'Senha incorreta.' } })
    await expect(sair({ userId: u.id, businessId: b.id, customerId: c.id, token })).rejects.toMatchObject({ fields: { password: 'Senha incorreta.' } })
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).anonymizedAt).toBeNull()
  })

  test('só Google: exige "excluir"; "EXCLUIR " também vale', async () => {
    const b = await makeBusiness()
    const u = await makeUser({ google: { sub: 'g-1', email: 'g1@exemplo.test' }, email: 'g1@exemplo.test' })
    const c = await makeCustomer(b.id, { userId: u.id })
    const sessao = await prisma.$transaction(async (tx) => (await import('@/server/auth/session')).openSession(tx, { userId: u.id, now: AGORA, customerBusinessId: b.id }))
    await expect(sair({ userId: u.id, businessId: b.id, customerId: c.id, token: sessao.token, confirm: 'sim' })).rejects.toMatchObject({ fields: { confirm: 'Digite excluir para confirmar.' } })
    await expect(sair({ userId: u.id, businessId: b.id, customerId: c.id, token: sessao.token })).rejects.toMatchObject({ fields: { confirm: 'Digite excluir para confirmar.' } })
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1)
    const r = await sair({ userId: u.id, businessId: b.id, customerId: c.id, token: sessao.token, confirm: `${DELETE_CONFIRM_WORD.toUpperCase()} ` })
    expect(r.personDeleted).toBe(true)
  })

  test('cadastro de outra pessoa ou de outra loja: não encontrado, e nada muda', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const u = await makeUser({ password: SENHA })
    const outra = await makeUser({ password: SENHA })
    const meu = await makeCustomer(a.id, { userId: u.id })
    const alheio = await makeCustomer(a.id, { userId: outra.id })
    const token = await entrar(u.id, a.id)
    await expect(sair({ userId: u.id, businessId: a.id, customerId: alheio.id, token, password: SENHA })).rejects.toMatchObject({ code: 'not_found' })
    await expect(sair({ userId: u.id, businessId: b.id, customerId: meu.id, token, password: SENHA })).rejects.toMatchObject({ code: 'not_found' })
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: alheio.id } })).anonymizedAt).toBeNull()
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: meu.id } })).anonymizedAt).toBeNull()
  })

  test('pedido pago não entregue: recusa "Conclua ou cancele os pedidos em andamento antes." e nada muda', async () => {
    const s = await cenaLoja({ now: AGORA })
    const u = await makeUser({ password: SENHA })
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { userId: u.id, linkedAt: AGORA, email: u.email } })
    const p = await produto(s.dono, { stock: 5 })
    const { order } = await pedidoComRetirada(s.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await marcarPago(order.id)
    const token = await entrar(u.id, s.b.id)
    await expect(sair({ userId: u.id, businessId: s.b.id, customerId: s.cliente.id, token, password: SENHA })).rejects.toMatchObject({
      message: 'Conclua ou cancele os pedidos em andamento antes.',
    })
    expect(await prisma.user.count({ where: { id: u.id } })).toBe(1)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: s.cliente.id } })).anonymizedAt).toBeNull()
  })

  test('horários futuros do cliente são cancelados', async () => {
    const b = await makeBusiness()
    const servico = await makeService(b.id)
    const ana = await makeProfessional(b.id, { serviceIds: [servico.id] })
    const u = await makeUser({ password: SENHA })
    const c = await makeCustomer(b.id, { userId: u.id })
    const futuro = await makeAppointment(b.id, { customerId: c.id, professionalId: ana.id, serviceId: servico.id, startsAt: addMinutes(AGORA, 3 * 1440) })
    const token = await entrar(u.id, b.id)
    await sair({ userId: u.id, businessId: b.id, customerId: c.id, token, password: SENHA })
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: futuro.id } })).status).toBe('CANCELED')
  })
})
