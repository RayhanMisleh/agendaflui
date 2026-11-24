import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { publicUsers } from '@/server/auth/user-public'
import { prisma } from '@/server/db/client'
import { sendAccessPasswordReset } from '@/server/domain/team/access'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeMembership, makePlatformAdmin, makeUpload, makeUser } from '../setup/factories'

const AGORA = new Date('2026-11-17T12:00:00.000Z')
let businessId: string
let userId: string

beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  userId = (await makeUser({ name: 'Rita Prado', email: 'rita@exemplo.test' })).id
  await makeMembership(businessId, userId, 'MANAGER')
})

describe('suporte não redefine a senha de ninguém', () => {
  test('o ator de suporte recebe forbidden em sendAccessPasswordReset e nada é criado', async () => {
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx({ id: businessId }, { now: AGORA, actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    const alvo = await makeUser()
    const m = await makeMembership(businessId, alvo.id, 'PROFESSIONAL')
    expect((await domainError(sendAccessPasswordReset(suporte, m.id))).code).toBe('forbidden')
    expect(await prisma.userToken.count()).toBe(0)
  })
})

describe('publicUsers', () => {
  test('só devolve quem tem vínculo (ativo ou não) naquela conta; a conta B nunca enxerga membro de A', async () => {
    const upload = await makeUpload(null)
    const ativo = await makeUser({ name: 'Ativo', avatarUploadId: upload.id })
    await makeMembership(businessId, ativo.id, 'MANAGER')
    const inativo = await makeUser({ name: 'Inativo' })
    const mi = await makeMembership(businessId, inativo.id, 'PROFESSIONAL')
    await prisma.membership.update({ where: { id: mi.id }, data: { active: false } })
    const contaB = (await makeBusiness()).id
    const deB = await makeUser({ name: 'Da B' })
    await makeMembership(contaB, deB.id, 'OWNER')
    const semVinculo = await makeUser({ name: 'Solto' })
    const ids = [ativo.id, inativo.id, deB.id, semVinculo.id, randomUUID(), 'nao-e-uuid', ativo.id]

    const emA = await publicUsers(businessId, ids)
    expect([...emA.keys()].sort()).toEqual([ativo.id, inativo.id].sort())
    expect(emA.get(ativo.id)).toEqual({ name: 'Ativo', email: ativo.email, avatarUrl: `/arquivos/${upload.path}` })
    expect(emA.get(inativo.id)).toEqual({ name: 'Inativo', email: inativo.email, avatarUrl: null })

    const emB = await publicUsers(contaB, ids)
    expect([...emB.keys()]).toEqual([deB.id])
    expect(JSON.stringify([...emB.values()])).not.toContain(ativo.email)
  })

  test('lista vazia ou conta inválida devolve mapa vazio sem consultar', async () => {
    expect((await publicUsers(businessId, [])).size).toBe(0)
    expect((await publicUsers('nao-e-uuid', [userId])).size).toBe(0)
  })

  test('nunca expõe hash de senha nem campos além de nome, e-mail e foto', async () => {
    const m = await publicUsers(businessId, [userId])
    expect(Object.keys(m.get(userId) ?? {}).sort()).toEqual(['avatarUrl', 'email', 'name'])
  })
})
