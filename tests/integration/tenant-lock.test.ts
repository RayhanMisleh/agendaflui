import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { lockKeyRaw, tenantDb, TenantViolationError } from '@/server/db/tenant'
import { resetDb } from '../setup/db'
import { makeBusiness } from '../setup/factories'

const PROF = '6f1d9c3e-5b0a-4c61-9d3e-2a7f8b1c4d50'
const pausa = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeEach(resetDb)

describe('$lockKey', () => {
  test('serializa duas transações da mesma conta sobre a mesma chave', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    const eventos: string[] = []
    let primeiraTrava!: () => void
    const primeiraTravou = new Promise<void>((resolve) => (primeiraTrava = resolve))

    const t1 = db.$transaction(async (tx) => {
      await tx.$lockKey('professional', PROF)
      eventos.push('t1 travou')
      primeiraTrava()
      await pausa(400)
      eventos.push('t1 vai terminar')
    })
    await primeiraTravou
    const t2 = db.$transaction(async (tx) => {
      eventos.push('t2 pediu')
      await tx.$lockKey('professional', PROF)
      eventos.push('t2 travou')
    })
    await Promise.all([t1, t2])
    expect(eventos).toEqual(['t1 travou', 't2 pediu', 't1 vai terminar', 't2 travou'])
  })

  test('chaves diferentes não se bloqueiam', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    const outro = '0b8e2f47-3d19-4a5c-8e60-71c2d9a4f3b8'
    let soltar!: () => void
    const segura = new Promise<void>((resolve) => (soltar = resolve))
    let travou!: () => void
    const primeiraTravou = new Promise<void>((resolve) => (travou = resolve))
    const t1 = db.$transaction(async (tx) => {
      await tx.$lockKey('professional', PROF)
      travou()
      await segura
    })
    await primeiraTravou
    const t2 = await Promise.race([
      db.$transaction((tx) => tx.$lockKey('professional', outro)).then(() => 'livre'),
      pausa(3000).then(() => 'bloqueada'),
    ])
    soltar()
    await t1
    expect(t2).toBe('livre')
  })

  test('a mesma chave em contas diferentes não se bloqueia', async () => {
    const [a, b] = [await makeBusiness(), await makeBusiness()]
    let soltar!: () => void
    const segura = new Promise<void>((resolve) => (soltar = resolve))
    let travou!: () => void
    const primeiraTravou = new Promise<void>((resolve) => (travou = resolve))
    const t1 = tenantDb(a.id).$transaction(async (tx) => {
      await tx.$lockKey('professional', PROF)
      travou()
      await segura
    })
    await primeiraTravou
    const t2 = await Promise.race([
      tenantDb(b.id).$transaction((tx) => tx.$lockKey('professional', PROF)).then(() => 'livre'),
      pausa(3000).then(() => 'bloqueada'),
    ])
    soltar()
    await t1
    expect(t2).toBe('livre')
  })

  test('fora de transação lança TenantViolationError', async () => {
    const b = await makeBusiness()
    await expect(tenantDb(b.id).$lockKey('professional', PROF)).rejects.toThrow(TenantViolationError)
  })

  test('escopo desconhecido e id malformado lançam dentro da transação', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    await expect(
      db.$transaction((tx) => tx.$lockKey('service' as 'professional', PROF)),
    ).rejects.toThrow(TenantViolationError)
    await expect(db.$transaction((tx) => tx.$lockKey('professional', 'x'))).rejects.toThrow(TenantViolationError)
    await expect(
      db.$transaction((tx) => tx.$lockKey('professional', `${PROF}'; select 1; --`)),
    ).rejects.toThrow(TenantViolationError)
  })

  test('a trava vale na transação: depois do commit outra transação a obtém na hora', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    await db.$transaction((tx) => tx.$lockKey('professional', PROF))
    const r = await Promise.race([
      db.$transaction((tx) => tx.$lockKey('professional', PROF)).then(() => 'livre'),
      pausa(3000).then(() => 'bloqueada'),
    ])
    expect(r).toBe('livre')
  })

  test('uma transação que falha solta a trava', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    await expect(
      db.$transaction(async (tx) => {
        await tx.$lockKey('professional', PROF)
        throw new Error('falhou')
      }),
    ).rejects.toThrow('falhou')
    const r = await Promise.race([
      db.$transaction((tx) => tx.$lockKey('professional', PROF)).then(() => 'livre'),
      pausa(3000).then(() => 'bloqueada'),
    ])
    expect(r).toBe('livre')
  })

  test('os demais métodos de SQL cru continuam bloqueados, dentro e fora de transação', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    await expect(db.$queryRaw`select 1`).rejects.toThrow(TenantViolationError)
    await expect(db.$executeRaw`select 1`).rejects.toThrow(TenantViolationError)
    await expect(db.$queryRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
    await expect(db.$executeRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
    await db.$transaction(async (tx) => {
      await tx.$lockKey('professional', PROF)
      await expect(tx.$queryRaw`select 1`).rejects.toThrow(TenantViolationError)
      await expect(tx.$executeRaw`select 1`).rejects.toThrow(TenantViolationError)
      await expect(tx.$queryRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
      await expect(tx.$executeRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
    })
    expect(await prisma.business.count()).toBeGreaterThan(0)
  })

  test('$executeRaw junto com $lockKey na mesma transação continua bloqueado', async () => {
    const b = await makeBusiness()
    await expect(
      tenantDb(b.id).$transaction(async (tx) => {
        await Promise.all([tx.$lockKey('professional', PROF), tx.$executeRaw`select 1`])
      }),
    ).rejects.toThrow(TenantViolationError)
  })

  test('$executeRaw numa terceira transação, enquanto outra espera a trava, continua bloqueado', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    let soltar!: () => void
    const segura = new Promise<void>((resolve) => (soltar = resolve))
    let travou!: () => void
    const primeiraTravou = new Promise<void>((resolve) => (travou = resolve))
    const t1 = db.$transaction(async (tx) => {
      await tx.$lockKey('professional', PROF)
      travou()
      await segura
    })
    await primeiraTravou
    const t2 = db.$transaction((tx) => tx.$lockKey('professional', PROF))
    const t3 = db.$transaction((tx) => tx.$executeRaw`select 1`)
    await expect(t3).rejects.toThrow(TenantViolationError)
    soltar()
    await Promise.all([t1, t2])
  })

  test('depois de $lockKey, com um temporizador no meio, o $executeRaw seguinte continua bloqueado', async () => {
    const b = await makeBusiness()
    await expect(
      tenantDb(b.id).$transaction(async (tx) => {
        await tx.$lockKey('professional', PROF)
        await pausa(0)
        await tx.$executeRaw`select 1`
      }),
    ).rejects.toThrow(TenantViolationError)
  })

  test('$lockKey extraído, sem this, lança e não roda fora de transação', async () => {
    const b = await makeBusiness()
    const { $lockKey } = tenantDb(b.id)
    await expect($lockKey('professional', PROF)).rejects.toThrow(TenantViolationError)
  })

  test('aceita o escopo membership e o separa do customer e do professional', async () => {
    const b = await makeBusiness()
    const db = tenantDb(b.id)
    await db.$transaction(async (tx) => {
      await tx.$lockKey('membership', PROF)
      const outros = await Promise.race([
        db.$transaction(async (t) => {
          await t.$lockKey('customer', PROF)
          await t.$lockKey('professional', PROF)
        }).then(() => 'livre'),
        pausa(1000).then(() => 'preso'),
      ])
      expect(outros).toBe('livre')
      const mesmo = await Promise.race([
        db.$transaction((t) => t.$lockKey('membership', PROF)).then(() => 'livre'),
        pausa(300).then(() => 'preso'),
      ])
      expect(mesmo).toBe('preso')
    })
  })
})

describe('as duas portas da trava', () => {
  const MEMBRO = '0b9d6f2e-1c3a-4e57-8a64-5d7c9e1f3a20'
  type Porta = 'tenant' | 'cru'

  async function seguraEEspera(primeira: Porta, segunda: Porta, businessId: string, escopo: 'membership' | 'business_owners') {
    let soltar!: () => void
    const solta = new Promise<void>((resolve) => (soltar = resolve))
    let primeiraTravou!: () => void
    const travou = new Promise<void>((resolve) => (primeiraTravou = resolve))
    let segundaPegou = false
    const pegar = async (porta: Porta, tx: unknown, depois: () => void) => {
      if (porta === 'tenant') await (tx as { $lockKey: (e: string, i: string) => Promise<void> }).$lockKey(escopo, MEMBRO)
      else await lockKeyRaw(tx as Parameters<typeof lockKeyRaw>[0], businessId, escopo, MEMBRO)
      depois()
    }
    const abrir = (porta: Porta, fn: (tx: never) => Promise<void>) =>
      porta === 'tenant' ? tenantDb(businessId).$transaction((tx) => fn(tx as never)) : prisma.$transaction((tx) => fn(tx as never))
    const t1 = abrir(primeira, async (tx) => {
      await pegar(primeira, tx, primeiraTravou)
      await solta
    })
    await travou
    const t2 = abrir(segunda, async (tx) => {
      await pegar(segunda, tx, () => (segundaPegou = true))
    })
    await pausa(300)
    expect(segundaPegou).toBe(false)
    soltar()
    await Promise.all([t1, t2])
    expect(segundaPegou).toBe(true)
  }

  test.each([
    ['tenant', 'cru'],
    ['cru', 'tenant'],
  ] as const)('%s segura e %s espera (mesma chave)', async (a, b) => {
    const conta = await makeBusiness()
    await seguraEEspera(a, b, conta.id, 'membership')
  })

  test('o escopo business_owners existe nas duas portas e não colide com membership', async () => {
    const conta = await makeBusiness()
    await seguraEEspera('tenant', 'cru', conta.id, 'business_owners')
    await tenantDb(conta.id).$transaction(async (tx) => {
      await tx.$lockKey('membership', MEMBRO)
      await tx.$lockKey('business_owners', MEMBRO)
    })
  })
})
