import 'server-only'
import { hkdfSync } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { tenantDb, type TenantClient, type TenantTx } from '@/server/db/tenant'
import { env } from '@/server/env'
import { addMinutes, fromEpochMs } from '@/server/time'
import { generateToken, hashToken } from './tokens'

export type AccessClaims =
  | { kind: 'customer'; businessId: string; customerId: string }
  | { kind: 'staff'; businessId: string; membershipId: string; userId: string }

export type TokenPair = {
  accessToken: string
  accessExpiresAt: Date
  refreshToken: string
  refreshExpiresAt: Date
}

type Meta = { ip: string | null; userAgent: string | null }

const ISSUER = 'agendaflui'
const AUDIENCE = 'api'
const ACCESS_MINUTES = 15
const REFRESH_MINUTES = 60 * 24 * 60
const MAX_USER_AGENT = 300
const MAX_TOKEN_LENGTH = 2048
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let chave: Uint8Array | undefined

/** Chave HS256 derivada do APP_SECRET por HKDF, calculada uma vez. */
function signingKey(): Uint8Array {
  chave ??= new Uint8Array(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/api-access/v1', 32))
  return chave
}

function epochSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000)
}

export async function signAccessToken(
  claims: AccessClaims,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const iat = epochSeconds(now)
  const exp = iat + ACCESS_MINUTES * 60
  const payload =
    claims.kind === 'customer'
      ? { bid: claims.businessId, knd: 'customer' }
      : { bid: claims.businessId, knd: 'staff', uid: claims.userId }
  const sub = claims.kind === 'customer' ? claims.customerId : claims.membershipId
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(signingKey())
  return { token, expiresAt: fromEpochMs(exp * 1000) }
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** Devolve as declarações ou `null` para token inválido, vencido, adulterado ou fora do formato. Nunca lança. */
export async function verifyAccessToken(token: string, now: Date): Promise<AccessClaims | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    })
    const { sub, bid, knd, uid } = payload
    if (!isUuid(sub) || !isUuid(bid)) return null
    if (knd === 'customer') return { kind: 'customer', businessId: bid, customerId: sub }
    if (knd === 'staff' && isUuid(uid)) return { kind: 'staff', businessId: bid, membershipId: sub, userId: uid }
    return null
  } catch {
    return null
  }
}

function cutUserAgent(userAgent: string | null): string | null {
  return userAgent === null ? null : userAgent.slice(0, MAX_USER_AGENT)
}

async function createRefresh(
  tx: TenantClient | TenantTx,
  claims: AccessClaims,
  familyId: string | undefined,
  meta: Meta,
  now: Date,
): Promise<TokenPair> {
  const access = await signAccessToken(claims, now)
  const { token, hash } = generateToken()
  const refreshExpiresAt = addMinutes(now, REFRESH_MINUTES)
  const owner =
    claims.kind === 'customer'
      ? { subject: 'CUSTOMER' as const, customerId: claims.customerId }
      : { subject: 'MEMBER' as const, membershipId: claims.membershipId }
  await tx.refreshToken.create({
    data: {
      businessId: claims.businessId,
      ...owner,
      ...(familyId ? { familyId } : { familyId: crypto.randomUUID() }),
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      ip: meta.ip,
      userAgent: cutUserAgent(meta.userAgent),
    },
  })
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: token,
    refreshExpiresAt,
  }
}

/** Emite o par de tokens de uma sessão nova (família nova), dentro da transação do chamador. */
export function issueTokens(
  tx: TenantClient | TenantTx,
  claims: AccessClaims,
  meta: Meta,
  now: Date,
): Promise<TokenPair> {
  return createRefresh(tx, claims, undefined, meta, now)
}

async function revokeFamily(tx: TenantClient | TenantTx, familyId: string, now: Date): Promise<void> {
  await tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } })
}

/**
 * Troca um token de renovação por um par novo na mesma família. Reuso de token usado ou revogado
 * revoga a família inteira (a revogação é gravada mesmo devolvendo `null`).
 */
export async function rotateRefreshToken(
  businessId: string,
  refreshToken: string,
  meta: Meta,
  now: Date,
): Promise<{ claims: AccessClaims; pair: TokenPair } | null> {
  if (!UUID.test(businessId) || typeof refreshToken !== 'string' || refreshToken.length === 0 || refreshToken.length > 200) {
    return null
  }
  const hash = hashToken(refreshToken)
  return tenantDb(businessId).$transaction(async (tx) => {
    const row = await tx.refreshToken.findFirst({ where: { tokenHash: hash } })
    if (!row) return null
    if (row.revokedAt !== null || row.usedAt !== null) {
      await revokeFamily(tx, row.familyId, now)
      return null
    }
    if (row.expiresAt.getTime() <= now.getTime()) return null

    let claims: AccessClaims
    if (row.subject === 'CUSTOMER' && row.customerId) {
      claims = { kind: 'customer', businessId, customerId: row.customerId }
    } else if (row.subject === 'MEMBER' && row.membershipId) {
      const membership = await tx.membership.findFirst({
        where: { id: row.membershipId },
        select: { userId: true, active: true },
      })
      if (!membership?.active) {
        await revokeFamily(tx, row.familyId, now)
        return null
      }
      claims = { kind: 'staff', businessId, membershipId: row.membershipId, userId: membership.userId }
    } else {
      return null
    }

    // Passo de reserva: só uma rotação concorrente consegue marcar o token como usado.
    const reserved = await tx.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    })
    if (reserved.count === 0) {
      await revokeFamily(tx, row.familyId, now)
      return null
    }
    const pair = await createRefresh(tx, claims, row.familyId, meta, now)
    return { claims, pair }
  })
}

/** Sair do app: revoga a família inteira do token. Token desconhecido não faz nada. */
export async function revokeRefreshToken(businessId: string, refreshToken: string, now: Date = new Date()): Promise<void> {
  if (!UUID.test(businessId) || typeof refreshToken !== 'string' || refreshToken.length === 0 || refreshToken.length > 200) {
    return
  }
  await tenantDb(businessId).$transaction(async (tx) => {
    const row = await tx.refreshToken.findFirst({ where: { tokenHash: hashToken(refreshToken) } })
    if (row) await revokeFamily(tx, row.familyId, now)
  })
}

/** Revoga todas as famílias vivas do cliente ou do vínculo. Devolve quantos tokens mudaram. */
export async function revokeAllFor(
  db: TenantClient | TenantTx,
  subject: { customerId: string } | { membershipId: string },
  now: Date = new Date(),
): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { ...subject, revokedAt: null },
    data: { revokedAt: now },
  })
  return result.count
}
