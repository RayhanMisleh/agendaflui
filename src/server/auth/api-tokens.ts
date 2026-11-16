import 'server-only'
import { hkdfSync, randomUUID } from 'node:crypto'
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

/** IP e user agent de quem pede (o `now` vem de quem chama). */
export type RequestMeta = { ip: string | null; userAgent: string | null }
type Meta = RequestMeta

const ISSUER = 'agendaflui'
const AUDIENCE = 'api'
const ACCESS_MINUTES = 15
const REFRESH_MINUTES = 60 * 24 * 60
const MAX_USER_AGENT = 300
const MAX_TOKEN_LENGTH = 2048
const REFRESH_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/
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
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
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
      typ: 'at+jwt',
      requiredClaims: ['exp', 'iat', 'sub'],
      maxTokenAge: ACCESS_MINUTES * 60,
      currentDate: now,
    })
    const { sub, bid, knd, uid, iat, exp } = payload
    if (typeof iat !== 'number' || typeof exp !== 'number') return null
    // `maxTokenAge` cobre `iat` no futuro e a idade, mas não a duração: confira `exp - iat`.
    if (exp - iat > ACCESS_MINUTES * 60) return null
    if (!isUuid(sub) || !isUuid(bid)) return null
    if (knd === 'customer') return uid === undefined ? { kind: 'customer', businessId: bid, customerId: sub } : null
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
      familyId: familyId ?? randomUUID(),
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

/** Formato do token de renovação (43 caracteres base64url) e conta com UUID; o resto nem consulta o banco. */
function validRefreshInput(businessId: string, refreshToken: string): boolean {
  return (
    typeof businessId === 'string' &&
    UUID.test(businessId) &&
    typeof refreshToken === 'string' &&
    REFRESH_TOKEN_FORMAT.test(refreshToken)
  )
}

/** Tipo de sujeito de um token de renovação: `customer` (cliente) ou `staff` (equipe). */
export type SubjectKind = AccessClaims['kind']

const subjectOf = (kind: SubjectKind): 'CUSTOMER' | 'MEMBER' => (kind === 'customer' ? 'CUSTOMER' : 'MEMBER')

/**
 * Troca um token de renovação por um par novo na mesma família. Reuso de token usado ou revogado
 * revoga a família inteira (a revogação é gravada mesmo devolvendo `null`).
 * Com `expected`, um token de outro tipo de sujeito é tratado como inválido (`null`) ANTES de qualquer
 * alteração: nada é consumido nem revogado (a rota de um app não derruba a sessão do outro).
 */
export async function rotateRefreshToken(
  businessId: string,
  refreshToken: string,
  meta: Meta,
  now: Date,
  expected?: SubjectKind,
): Promise<{ claims: AccessClaims; pair: TokenPair } | null> {
  if (!validRefreshInput(businessId, refreshToken)) return null
  const hash = hashToken(refreshToken)
  return tenantDb(businessId).$transaction(async (tx) => {
    // A primeira leitura só descobre o sujeito; tudo é decidido pela releitura depois da trava.
    const first = await tx.refreshToken.findFirst({ where: { tokenHash: hash } })
    if (!first) return null
    if (expected !== undefined && first.subject !== subjectOf(expected)) return null
    const subjectId = first.subject === 'CUSTOMER' ? first.customerId : first.membershipId
    if (!subjectId) return null
    // Trava do sujeito: serializa com `revokeAllFor` e com a saída do app, que assim enxergam o token novo.
    await tx.$lockKey(first.subject === 'CUSTOMER' ? 'customer' : 'membership', subjectId)

    const row = await tx.refreshToken.findFirst({ where: { id: first.id } })
    if (!row) return null
    if (row.revokedAt !== null || row.usedAt !== null) {
      await revokeFamily(tx, row.familyId, now)
      return null
    }
    if (row.expiresAt.getTime() <= now.getTime()) return null

    // Conta que não está ativa: recusa sem revogar nem consumir o token (reativar retoma as sessões).
    const business = await tx.business.findFirst({ select: { status: true } })
    if (business?.status !== 'ACTIVE') return null

    let claims: AccessClaims
    if (row.subject === 'CUSTOMER' && row.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: row.customerId },
        select: { archivedAt: true, anonymizedAt: true },
      })
      if (!customer || customer.archivedAt !== null || customer.anonymizedAt !== null) {
        await revokeFamily(tx, row.familyId, now)
        return null
      }
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

    // Passo de reserva: decide a corrida entre duas rotações do mesmo token.
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

/**
 * Sair do app: revoga a família inteira do token. Token desconhecido não faz nada; com `expected`, token de outro
 * tipo de sujeito também não.
 */
export async function revokeRefreshToken(
  businessId: string,
  refreshToken: string,
  now: Date = new Date(),
  expected?: SubjectKind,
): Promise<void> {
  if (!validRefreshInput(businessId, refreshToken)) return
  await tenantDb(businessId).$transaction(async (tx) => {
    const first = await tx.refreshToken.findFirst({ where: { tokenHash: hashToken(refreshToken) } })
    if (!first) return
    if (expected !== undefined && first.subject !== subjectOf(expected)) return
    const subjectId = first.subject === 'CUSTOMER' ? first.customerId : first.membershipId
    if (!subjectId) return
    await tx.$lockKey(first.subject === 'CUSTOMER' ? 'customer' : 'membership', subjectId)
    await revokeFamily(tx, first.familyId, now)
  })
}

/**
 * Revoga todas as famílias vivas do cliente ou do vínculo. Devolve quantos tokens mudaram.
 * Trava o sujeito antes do UPDATE para não perder o token que uma rotação em andamento acabou de criar.
 * A trava de vínculo nunca é pega junto com a de cliente nos fluxos atuais (ordem do projeto: cliente primeiro).
 * Quem chama com `customerId` não pode já estar segurando travas de `professional` (cliente vem primeiro).
 */
export async function revokeAllFor(
  db: TenantClient | TenantTx,
  subject: { customerId: string } | { membershipId: string },
  now: Date = new Date(),
): Promise<number> {
  const run = async (tx: TenantTx): Promise<number> => {
    if ('customerId' in subject) await tx.$lockKey('customer', subject.customerId)
    else await tx.$lockKey('membership', subject.membershipId)
    const result = await tx.refreshToken.updateMany({ where: { ...subject, revokedAt: null }, data: { revokedAt: now } })
    return result.count
  }
  if (typeof Reflect.get(db, '$transaction') === 'function') return (db as TenantClient).$transaction(run)
  return run(db as TenantTx)
}
