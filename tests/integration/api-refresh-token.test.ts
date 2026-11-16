import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import {
  issueTokens,
  revokeAllFor,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
  type AccessClaims,
} from '@/server/auth/api-tokens'
import { hashToken } from '@/server/auth/tokens'
import { addMinutes, fromEpochMs } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../setup/factories'

const now = fromEpochMs(1_800_000_000_000)
const meta = { ip: '203.0.113.9', userAgent: 'AgendaFlui/1.0' }
const DIA = 24 * 60

beforeEach(resetDb)

async function emitirCliente(businessId: string, customerId?: string) {
  const id = customerId ?? (await makeCustomer(businessId)).id
  const claims: AccessClaims = { kind: 'customer', businessId, customerId: id }
  const pair = await tenantDb(businessId).$transaction((tx) => issueTokens(tx, claims, meta, now))
  return { claims, pair }
}

describe('issueTokens', () => {
  test('cria uma família com validade de 60 dias, guarda só o hash e o token de acesso vale', async () => {
    const a = await makeBusiness()
    const { claims, pair } = await emitirCliente(a.id)
    expect(pair.refreshExpiresAt.getTime()).toBe(addMinutes(now, 60 * DIA).getTime())
    expect(pair.accessExpiresAt.getTime()).toBe(addMinutes(now, 15).getTime())
    expect(await verifyAccessToken(pair.accessToken, now)).toEqual(claims)
    const linhas = await prisma.refreshToken.findMany()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      businessId: a.id,
      subject: 'CUSTOMER',
      tokenHash: hashToken(pair.refreshToken),
      usedAt: null,
      revokedAt: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    const brutas = await prisma.$queryRaw<unknown[]>`SELECT to_jsonb(r) AS j FROM refresh_tokens r`
    expect(JSON.stringify(brutas)).not.toContain(pair.refreshToken)
    expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('corta o user agent em 300 caracteres', async () => {
    const a = await makeBusiness()
    const c = await makeCustomer(a.id)
    await tenantDb(a.id).$transaction((tx) =>
      issueTokens(tx, { kind: 'customer', businessId: a.id, customerId: c.id }, { ip: null, userAgent: 'x'.repeat(500) }, now),
    )
    const linha = await prisma.refreshToken.findFirstOrThrow()
    expect(linha.userAgent).toHaveLength(300)
    expect(linha.ip).toBeNull()
  })

  test('equipe: grava o vínculo e a rotação devolve o userId no acesso', async () => {
    const a = await makeBusiness()
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'OWNER')
    const claims: AccessClaims = { kind: 'staff', businessId: a.id, membershipId: m.id, userId: user.id }
    const pair = await tenantDb(a.id).$transaction((tx) => issueTokens(tx, claims, meta, now))
    expect(await prisma.refreshToken.findFirstOrThrow()).toMatchObject({ subject: 'MEMBER', membershipId: m.id, customerId: null })
    const r = await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))
    expect(r?.claims).toEqual(claims)
  })
})

describe('rotateRefreshToken', () => {
  test('devolve par novo na mesma família e o antigo deixa de valer', async () => {
    const a = await makeBusiness()
    const { claims, pair } = await emitirCliente(a.id)
    const depois = addMinutes(now, 10)
    const r = await rotateRefreshToken(a.id, pair.refreshToken, meta, depois)
    expect(r).not.toBeNull()
    expect(r?.claims).toEqual(claims)
    expect(r?.pair.refreshToken).not.toBe(pair.refreshToken)
    expect(r?.pair.refreshExpiresAt.getTime()).toBe(addMinutes(depois, 60 * DIA).getTime())
    expect(await verifyAccessToken(r?.pair.accessToken ?? '', depois)).toEqual(claims)
    const linhas = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } })
    expect(linhas).toHaveLength(2)
    expect(linhas[0]?.familyId).toBe(linhas[1]?.familyId)
    expect(linhas[0]?.usedAt?.getTime()).toBe(depois.getTime())
    expect(linhas[1]?.usedAt).toBeNull()
    // O novo continua rotacionando.
    expect(await rotateRefreshToken(a.id, r?.pair.refreshToken ?? '', meta, addMinutes(depois, 1))).not.toBeNull()
  })

  test('reusar o token antigo devolve null e revoga a família inteira, inclusive o novo', async () => {
    const a = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    const r = await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))
    expect(await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 2))).toBeNull()
    const linhas = await prisma.refreshToken.findMany()
    expect(linhas.every((l) => l.revokedAt !== null)).toBe(true)
    expect(await rotateRefreshToken(a.id, r?.pair.refreshToken ?? '', meta, addMinutes(now, 3))).toBeNull()
  })

  test('token revogado devolve null e revoga a família', async () => {
    const a = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    await prisma.refreshToken.updateMany({ data: { revokedAt: now } })
    expect(await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))).toBeNull()
  })

  test('token da conta A com o businessId de B devolve null e a família de A continua válida', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    expect(await rotateRefreshToken(b.id, pair.refreshToken, meta, addMinutes(now, 1))).toBeNull()
    const linha = await prisma.refreshToken.findFirstOrThrow()
    expect(linha.revokedAt).toBeNull()
    expect(linha.usedAt).toBeNull()
    expect(await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 2))).not.toBeNull()
  })

  test('vencido devolve null sem emitir nada', async () => {
    const a = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    expect(await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 60 * DIA + 1))).toBeNull()
    expect(await prisma.refreshToken.count()).toBe(1)
  })

  test('token desconhecido ou malformado devolve null', async () => {
    const a = await makeBusiness()
    expect(await rotateRefreshToken(a.id, 'nao-existe', meta, now)).toBeNull()
    expect(await rotateRefreshToken(a.id, '', meta, now)).toBeNull()
    expect(await rotateRefreshToken('nao-e-uuid', 'x', meta, now)).toBeNull()
  })

  test('10 rotações simultâneas do mesmo token: exatamente uma devolve par', async () => {
    const a = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))),
    )
    expect(rs.filter((r) => r !== null)).toHaveLength(1)
    expect(rs.filter((r) => r === null)).toHaveLength(9)
    // A revogação por reuso foi gravada mesmo com as perdedoras devolvendo null.
    const linhas = await prisma.refreshToken.findMany()
    expect(linhas).toHaveLength(2)
    expect(linhas.every((l) => l.revokedAt !== null)).toBe(true)
  })
})

describe('revokeRefreshToken e revokeAllFor', () => {
  test('revokeRefreshToken revoga a família do token; desconhecido não faz nada', async () => {
    const a = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    const r = await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))
    const outra = await emitirCliente(a.id)
    await revokeRefreshToken(a.id, 'desconhecido')
    expect(await prisma.refreshToken.count({ where: { revokedAt: { not: null } } })).toBe(0)
    await revokeRefreshToken(a.id, r?.pair.refreshToken ?? '')
    expect(await prisma.refreshToken.count({ where: { revokedAt: { not: null } } })).toBe(2)
    expect(await rotateRefreshToken(a.id, outra.pair.refreshToken, meta, addMinutes(now, 2))).not.toBeNull()
  })

  test('revokeRefreshToken com a conta errada não revoga', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const { pair } = await emitirCliente(a.id)
    await revokeRefreshToken(b.id, pair.refreshToken)
    expect(await prisma.refreshToken.count({ where: { revokedAt: { not: null } } })).toBe(0)
  })

  test('revokeAllFor invalida todas as famílias do cliente e só dele', async () => {
    const a = await makeBusiness()
    const c1 = await makeCustomer(a.id)
    const t1 = await emitirCliente(a.id, c1.id)
    const t2 = await emitirCliente(a.id, c1.id)
    const outro = await emitirCliente(a.id)
    const n = await revokeAllFor(tenantDb(a.id), { customerId: c1.id })
    expect(n).toBe(2)
    expect(await rotateRefreshToken(a.id, t1.pair.refreshToken, meta, addMinutes(now, 1))).toBeNull()
    expect(await rotateRefreshToken(a.id, t2.pair.refreshToken, meta, addMinutes(now, 1))).toBeNull()
    expect(await rotateRefreshToken(a.id, outro.pair.refreshToken, meta, addMinutes(now, 1))).not.toBeNull()
    expect(await revokeAllFor(tenantDb(a.id), { customerId: c1.id })).toBe(0)
  })

  test('revokeAllFor por vínculo', async () => {
    const a = await makeBusiness()
    const user = await makeUser()
    const m = await makeMembership(a.id, user.id, 'MANAGER')
    const claims: AccessClaims = { kind: 'staff', businessId: a.id, membershipId: m.id, userId: user.id }
    const pair = await tenantDb(a.id).$transaction((tx) => issueTokens(tx, claims, meta, now))
    expect(await revokeAllFor(tenantDb(a.id), { membershipId: m.id })).toBe(1)
    expect(await rotateRefreshToken(a.id, pair.refreshToken, meta, addMinutes(now, 1))).toBeNull()
  })
})
