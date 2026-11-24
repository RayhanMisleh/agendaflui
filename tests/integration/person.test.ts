import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { activatePerson, consumeInvites, personState, syncCustomerCopies } from '@/server/auth/person'
import { generateToken } from '@/server/auth/tokens'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeUser } from '../setup/factories'

const AGORA = new Date('2026-11-23T12:00:00Z')

beforeEach(async () => {
  await resetDb()
})

async function convite(userId: string): Promise<void> {
  await prisma.userToken.create({ data: { userId, purpose: 'INVITE', tokenHash: generateToken().hash, expiresAt: new Date('2026-12-30T00:00:00Z') } })
}

test('personState: sem senha e sem Google é pendente; com qualquer um é ativa', () => {
  expect(personState({ passwordHash: null, googleSub: null })).toBe('pending')
  expect(personState({ passwordHash: 'h', googleSub: null })).toBe('active')
  expect(personState({ passwordHash: null, googleSub: 's' })).toBe('active')
})

describe('activatePerson', () => {
  test('com senha: grava, verifica o e-mail e consome todos os convites', async () => {
    const u = await makeUser({ password: null })
    await convite(u.id)
    await convite(u.id)
    const ok = await prisma.$transaction((tx) => activatePerson(tx, u.id, { passwordHash: 'hash-novo' }, AGORA))
    expect(ok).toBe(true)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(depois).toMatchObject({ passwordHash: 'hash-novo', emailVerifiedAt: AGORA })
    expect(await prisma.userToken.count({ where: { userId: u.id, usedAt: null } })).toBe(0)
    expect(await prisma.userToken.count({ where: { userId: u.id, usedAt: AGORA } })).toBe(2)
  })

  test('com Google: grava sub, e-mail do Google e instante, e verifica', async () => {
    const u = await makeUser({ password: null })
    const ok = await prisma.$transaction((tx) => activatePerson(tx, u.id, { google: { sub: 'sub-1', email: 'g@exemplo.test' } }, AGORA))
    expect(ok).toBe(true)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({
      passwordHash: null,
      googleSub: 'sub-1',
      googleEmail: 'g@exemplo.test',
      googleLinkedAt: AGORA,
      emailVerifiedAt: AGORA,
    })
  })

  test('mantém a verificação anterior (convite já provado)', async () => {
    const antes = new Date('2026-10-01T00:00:00Z')
    const u = await makeUser({ password: null, emailVerifiedAt: antes })
    await prisma.$transaction((tx) => activatePerson(tx, u.id, { passwordHash: 'h' }, AGORA))
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).toEqual(antes)
  })

  test('em pessoa ativa devolve false e não muda nada (nem convites)', async () => {
    const u = await makeUser({ password: 'senha-bem-longa' })
    await convite(u.id)
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    const ok = await prisma.$transaction((tx) => activatePerson(tx, u.id, { passwordHash: 'outro' }, AGORA))
    expect(ok).toBe(false)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toEqual(antes)
    expect(await prisma.userToken.count({ where: { userId: u.id, usedAt: null } })).toBe(1)
  })
})

test('consumeInvites só marca os convites da pessoa', async () => {
  const a = await makeUser({ password: null })
  const b = await makeUser({ password: null })
  await convite(a.id)
  await convite(b.id)
  await prisma.$transaction((tx) => consumeInvites(tx, a.id, AGORA))
  expect(await prisma.userToken.count({ where: { userId: a.id, usedAt: null } })).toBe(0)
  expect(await prisma.userToken.count({ where: { userId: b.id, usedAt: null } })).toBe(1)
})

describe('syncCustomerCopies', () => {
  test('atualiza as lojas da pessoa (nome com search_name, telefone, e-mail) e não toca cliente de outra pessoa', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const pessoa = await makeUser({ email: 'ana@exemplo.test' })
    const outra = await makeUser({ email: 'bia@exemplo.test' })
    const c1 = await makeCustomer(a.id, { userId: pessoa.id, name: 'Ana' })
    const c2 = await makeCustomer(b.id, { userId: pessoa.id, name: 'Ana' })
    const dela = await makeCustomer(a.id, { userId: outra.id, name: 'Bia' })
    await prisma.$transaction((tx) => syncCustomerCopies(tx, pessoa.id, { name: 'Ana Álvares', phone: '5511988887777', email: 'nova@exemplo.test' }))
    for (const id of [c1.id, c2.id]) {
      expect(await prisma.customer.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: 'Ana Álvares', searchName: 'ana alvares', phone: '5511988887777', email: 'nova@exemplo.test' })
    }
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: dela.id } })).toMatchObject({ name: 'Bia', email: 'bia@exemplo.test' })
  })

  test('sem campos não faz nada', async () => {
    const a = await makeBusiness()
    const pessoa = await makeUser()
    const c = await makeCustomer(a.id, { userId: pessoa.id, name: 'Ana' })
    await prisma.$transaction((tx) => syncCustomerCopies(tx, pessoa.id, {}))
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Ana')
  })
})
