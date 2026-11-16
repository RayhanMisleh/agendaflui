import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { registerDevice, removeDevice } from '@/server/domain/customers/devices'
import { domainError } from '../setup/expect'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer } from '../setup/factories'

const TOKEN = 'token-do-aparelho-0123456789'

beforeEach(resetDb)

describe('aparelhos de quem usa o app', () => {
  test('o membro da equipe registra pelo vínculo e remove só o próprio', async () => {
    const b = await makeBusiness()
    const membro = await ctxWithRole(b, 'PROFESSIONAL')
    await registerDevice(membro, { platform: 'ios', pushToken: TOKEN })
    const [registrado] = await prisma.device.findMany({ where: { businessId: b.id } })
    expect(registrado).toMatchObject({ customerId: null, membershipId: membro.actor.kind === 'member' ? membro.actor.membershipId : '', platform: 'IOS' })

    await removeDevice(await ctxWithRole(b, 'MANAGER'), TOKEN)
    expect(await prisma.device.count({ where: { businessId: b.id } })).toBe(1)
    await removeDevice(membro, TOKEN)
    expect(await prisma.device.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('o mesmo token passa do cliente à equipe e volta, sempre com um dono só', async () => {
    const b = await makeBusiness()
    const cliente = await makeCustomer(b.id)
    const doCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name } })
    const daEquipe = await ctxWithRole(b, 'OWNER')
    await registerDevice(doCliente, { platform: 'android', pushToken: TOKEN })
    await registerDevice(daEquipe, { platform: 'android', pushToken: TOKEN })
    expect(await prisma.device.findMany({ where: { businessId: b.id }, select: { customerId: true } })).toEqual([{ customerId: null }])
    await registerDevice(doCliente, { platform: 'android', pushToken: TOKEN })
    expect(await prisma.device.findMany({ where: { businessId: b.id }, select: { membershipId: true } })).toEqual([{ membershipId: null }])
  })

  test('visitante e sistema não têm aparelho', async () => {
    const b = await makeBusiness()
    for (const actor of [{ kind: 'guest' }, { kind: 'system' }] as const) {
      const ctx = await makeCtx(b, { actor })
      expect((await domainError(registerDevice(ctx, { platform: 'web', pushToken: TOKEN }))).code).toBe('forbidden')
      expect((await domainError(removeDevice(ctx, TOKEN))).code).toBe('forbidden')
    }
  })
})
