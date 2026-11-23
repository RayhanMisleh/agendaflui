import { beforeEach, describe, expect, test } from 'vitest'
import type { Business } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../setup/factories'

let n = 0
const un = (): string => `${++n}`
const depois = (): Date => new Date(Date.now() + 3_600_000)

const token = (businessId: string, o: Record<string, unknown> = {}) =>
  prisma.refreshToken.create({
    data: { businessId, subject: 'CUSTOMER', familyId: crypto.randomUUID(), tokenHash: `rt-${un()}`, expiresAt: depois(), ...o },
  })
const aparelho = (businessId: string, o: Record<string, unknown> = {}) =>
  prisma.device.create({
    data: { businessId, platform: 'IOS', pushToken: `push-${un()}`, lastSeenAt: new Date(), ...o },
  })

let a: Business, b: Business
beforeEach(async () => {
  await resetDb()
  ;[a, b] = [await makeBusiness(), await makeBusiness()]
})

describe('refresh_tokens', () => {
  test('exatamente um dono, coerente com o subject', async () => {
    const c = await makeCustomer(a.id)
    const m = await makeMembership(a.id, (await makeUser()).id, 'OWNER')
    await expect(token(a.id, { subject: 'CUSTOMER' })).rejects.toThrow()
    await expect(token(a.id, { subject: 'CUSTOMER', customerId: c.id, membershipId: m.id })).rejects.toThrow()
    await expect(token(a.id, { subject: 'CUSTOMER', membershipId: m.id })).rejects.toThrow()
    await expect(token(a.id, { subject: 'MEMBER', customerId: c.id })).rejects.toThrow()
    await expect(token(a.id, { subject: 'CUSTOMER', customerId: c.id })).resolves.toBeDefined()
    await expect(token(a.id, { subject: 'MEMBER', membershipId: m.id })).resolves.toBeDefined()
  })

  test('cliente e membro de outra conta são recusados pela FK composta', async () => {
    const deB = await makeCustomer(b.id)
    const mB = await makeMembership(b.id, (await makeUser()).id, 'OWNER')
    await expect(token(a.id, { subject: 'CUSTOMER', customerId: deB.id })).rejects.toThrow()
    await expect(token(a.id, { subject: 'MEMBER', membershipId: mB.id })).rejects.toThrow()
  })

  test('token_hash é único e apagar o cliente apaga os tokens dele', async () => {
    const c = await makeCustomer(a.id)
    const t = await token(a.id, { subject: 'CUSTOMER', customerId: c.id, tokenHash: 'igual' })
    await expect(token(a.id, { subject: 'CUSTOMER', customerId: c.id, tokenHash: 'igual' })).rejects.toThrow()
    await prisma.customer.delete({ where: { id: c.id } })
    expect(await prisma.refreshToken.findUnique({ where: { id: t.id } })).toBeNull()
  })

  test('apagar o membro apaga os tokens dele', async () => {
    const m = await makeMembership(a.id, (await makeUser()).id, 'MANAGER')
    const t = await token(a.id, { subject: 'MEMBER', membershipId: m.id })
    await prisma.membership.delete({ where: { id: m.id } })
    expect(await prisma.refreshToken.findUnique({ where: { id: t.id } })).toBeNull()
  })
})

describe('devices', () => {
  test('exatamente um dono', async () => {
    const c = await makeCustomer(a.id)
    const m = await makeMembership(a.id, (await makeUser()).id, 'OWNER')
    await expect(aparelho(a.id)).rejects.toThrow()
    await expect(aparelho(a.id, { customerId: c.id, membershipId: m.id })).rejects.toThrow()
    await expect(aparelho(a.id, { customerId: c.id })).resolves.toBeDefined()
    await expect(aparelho(a.id, { membershipId: m.id })).resolves.toBeDefined()
  })

  test('cliente e membro de outra conta são recusados pela FK composta', async () => {
    const deB = await makeCustomer(b.id)
    const mB = await makeMembership(b.id, (await makeUser()).id, 'OWNER')
    await expect(aparelho(a.id, { customerId: deB.id })).rejects.toThrow()
    await expect(aparelho(a.id, { membershipId: mB.id })).rejects.toThrow()
  })

  test('mesmo push_token na mesma conta é recusado; em contas diferentes é aceito', async () => {
    const [ca, cb] = [await makeCustomer(a.id), await makeCustomer(b.id)]
    await aparelho(a.id, { customerId: ca.id, pushToken: 'ExponentPushToken[x]' })
    await expect(aparelho(a.id, { customerId: ca.id, pushToken: 'ExponentPushToken[x]' })).rejects.toThrow()
    await expect(aparelho(b.id, { customerId: cb.id, pushToken: 'ExponentPushToken[x]' })).resolves.toBeDefined()
  })

  test('apagar o cliente apaga os dispositivos dele', async () => {
    const c = await makeCustomer(a.id)
    const d = await aparelho(a.id, { customerId: c.id })
    await prisma.customer.delete({ where: { id: c.id } })
    expect(await prisma.device.findUnique({ where: { id: d.id } })).toBeNull()
  })
})

describe('verification_codes', () => {
  const codigo = (o: Record<string, unknown> = {}) =>
    prisma.verificationCode.create({
      data: { businessId: a.id, purpose: 'REGISTER', email: 'x@exemplo.test', codeHash: 'h', expiresAt: depois(), ...o },
    })

  test('e-mail não normalizado e tentativas negativas são recusados; padrões corretos', async () => {
    await expect(codigo({ email: 'X@exemplo.test' })).rejects.toThrow()
    await expect(codigo({ email: ' x@exemplo.test' })).rejects.toThrow()
    await expect(codigo({ attempts: -1 })).rejects.toThrow()
    const ok = await codigo()
    expect(ok.attempts).toBe(0)
    expect(ok.payload).toEqual({})
  })

  test('apagar a conta apaga os códigos', async () => {
    const c = await codigo()
    await prisma.business.delete({ where: { id: a.id } })
    expect(await prisma.verificationCode.findUnique({ where: { id: c.id } })).toBeNull()
  })
})

describe('rate_limit_buckets', () => {
  test('chave é primária; contagem negativa é recusada', async () => {
    const data = { key: 'ip:1.2.3.4', windowStart: new Date(), count: 1 }
    await prisma.rateLimitBucket.create({ data })
    await expect(prisma.rateLimitBucket.create({ data })).rejects.toThrow()
    await expect(prisma.rateLimitBucket.create({ data: { ...data, key: 'k2', count: -1 } })).rejects.toThrow()
  })
})

describe('api_usage_hourly', () => {
  const hora = new Date('2026-11-20T10:00:00.000Z')
  const uso = (o: Record<string, unknown> = {}) =>
    prisma.apiUsageHourly.create({
      data: { businessId: a.id, route: 'GET /v1/services', hour: hora, count: 1, errorCount: 0, totalMs: 10n, maxMs: 10, ...o },
    })

  test('(business_id, route, hour) repetido é recusado; outra rota, hora ou conta é aceita', async () => {
    await uso()
    await expect(uso()).rejects.toThrow()
    await expect(uso({ route: 'GET /v1/me' })).resolves.toBeDefined()
    await expect(uso({ hour: new Date('2026-11-20T11:00:00.000Z') })).resolves.toBeDefined()
    await expect(uso({ businessId: b.id })).resolves.toBeDefined()
    await expect(uso({ businessId: null })).rejects.toThrow()
  })

  test('hora fora do início da hora e contadores negativos são recusados', async () => {
    await expect(uso({ hour: new Date('2026-11-20T10:30:00.000Z') })).rejects.toThrow()
    for (const campo of [{ count: -1 }, { errorCount: -1 }, { totalMs: -1n }, { maxMs: -1 }]) {
      await expect(uso(campo), JSON.stringify(campo, (_, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))).rejects.toThrow()
    }
  })

  test('a hora é conferida em UTC, qualquer que seja o fuso da sessão do banco', async () => {
    // SQL cru com o instante explícito em UTC: o cliente Prisma mandaria a hora sem fuso, e o banco a leria no fuso da sessão.
    const naSessao = (fuso: string, hour: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${fuso}'`)
        await tx.$executeRaw`
          INSERT INTO api_usage_hourly (business_id, route, hour, count, error_count, total_ms, max_ms, updated_at)
          VALUES (${a.id}::uuid, ${`GET /v1/${fuso}`}, ${hour}::timestamptz, 1, 0, 1, 1, now())`
      })
    await expect(naSessao('Asia/Kolkata', '2026-11-20T10:00:00.000Z')).resolves.toBeUndefined()
    await expect(naSessao('America/Sao_Paulo', '2026-11-20T10:00:00.000Z')).resolves.toBeUndefined()
    await expect(naSessao('Asia/Kolkata', '2026-11-20T10:30:00.000Z')).rejects.toThrow(/api_usage_hourly_hour_check/)
    await expect(naSessao('UTC', '2026-11-20T10:00:00.500Z')).rejects.toThrow(/api_usage_hourly_hour_check/)
  })

  test('apagar a conta apaga o uso dela', async () => {
    const u = await uso()
    const outro = await uso({ businessId: b.id })
    await prisma.business.delete({ where: { id: a.id } })
    expect(await prisma.apiUsageHourly.findUnique({ where: { id: u.id } })).toBeNull()
    expect(await prisma.apiUsageHourly.findUnique({ where: { id: outro.id } })).not.toBeNull()
  })
})

describe('notifications', () => {
  test('ganha locked_until e skip_reason anuláveis', async () => {
    const c = await makeCustomer(a.id)
    const nt = await prisma.notification.create({
      data: {
        businessId: a.id, kind: 'APPOINTMENT_CONFIRMED', channel: 'EMAIL', customerId: c.id,
        scheduledFor: new Date(), dedupeKey: 'k', lockedUntil: depois(), skipReason: 'sem e-mail',
      },
    })
    expect(nt.lockedUntil).toBeInstanceOf(Date)
    expect(nt.skipReason).toBe('sem e-mail')
  })
})

describe('notifications: índices', () => {
  test('o índice de (status, scheduled_for) sem a trava sumiu; o que o cobre continua', async () => {
    const linhas = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications'`
    const nomes = linhas.map((l) => l.indexname)
    expect(nomes).not.toContain('notifications_status_scheduled_for_idx')
    expect(nomes).toContain('notifications_status_scheduled_for_locked_until_idx')
  })
})
