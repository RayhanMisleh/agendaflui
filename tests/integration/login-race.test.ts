import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loginPlatformAdmin } from '@/server/auth/platform-auth'
import { loginUser } from '@/server/auth/member-auth'
import { hashPassword } from '@/server/auth/password'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

/*
 * Troca de senha entre a conferência do hash e a gravação da sessão: o login que começou com a senha ANTIGA não pode
 * deixar sessão. A troca é simulada logo depois da leitura do usuário (a conferência já usou o hash antigo).
 */

beforeEach(async () => {
  await resetDb()
})
afterEach(() => vi.restoreAllMocks())

describe('login condicional ao hash conferido', () => {
  test('painel: troca entre a leitura e a gravação falha com invalid_credentials e nenhuma sessão fica', async () => {
    const user = await makeUser({ email: 'ana@exemplo.test', password: 'senha-antiga-1' })
    const conta = await makeBusiness()
    await makeMembership(conta.id, user.id, 'OWNER')
    const original = prisma.user.findUnique.bind(prisma.user)
    vi.spyOn(prisma.user, 'findUnique').mockImplementationOnce(((args: Parameters<typeof original>[0]) => {
      const lido = original(args)
      return lido.then(async (u) => {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword('senha-nova-bem-longa') } })
        return u
      })
    }) as never)
    await expect(loginUser({ email: 'ana@exemplo.test', password: 'senha-antiga-1' })).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).toBeNull()
  })

  test('admin da plataforma: troca entre a leitura e a gravação falha e nenhuma sessão fica', async () => {
    const admin = await makePlatformAdmin({ email: 'root@exemplo.test', password: 'senha-antiga-1' })
    const original = prisma.platformAdmin.findUnique.bind(prisma.platformAdmin)
    vi.spyOn(prisma.platformAdmin, 'findUnique').mockImplementationOnce(((args: Parameters<typeof original>[0]) => {
      const lido = original(args)
      return lido.then(async (a) => {
        await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword('senha-nova-bem-longa') } })
        return a
      })
    }) as never)
    await expect(loginPlatformAdmin({ email: 'root@exemplo.test', password: 'senha-antiga-1' })).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(await prisma.platformSession.count({ where: { adminId: admin.id } })).toBe(0)
  })

  test('sem troca, os dois logins continuam entrando e gravando o último acesso', async () => {
    const user = await makeUser({ email: 'ok@exemplo.test', password: 'senha-antiga-1' })
    const conta = await makeBusiness()
    await makeMembership(conta.id, user.id, 'OWNER')
    const admin = await makePlatformAdmin({ email: 'adm@exemplo.test', password: 'senha-antiga-1' })
    expect((await loginUser({ email: 'ok@exemplo.test', password: 'senha-antiga-1' })).session.user.id).toBe(user.id)
    await loginPlatformAdmin({ email: 'adm@exemplo.test', password: 'senha-antiga-1' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).not.toBeNull()
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })).lastLoginAt).not.toBeNull()
  })
})
