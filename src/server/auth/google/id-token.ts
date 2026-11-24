import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { normalizeEmail } from '@/server/domain/customers/contact'

/** A identidade que o Google atesta no `id_token` já conferido. */
export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string | null }

/** O `id_token` não vale. A mensagem é nossa: nunca traz o token nem o texto do erro da biblioteca. */
export class GoogleTokenError extends Error {
  constructor(message = 'O Google enviou uma identidade que não conseguimos confirmar.') {
    super(message)
    this.name = 'GoogleTokenError'
  }
}

const EMISSORES = ['https://accounts.google.com', 'accounts.google.com']

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Confere o `id_token`: assinatura (RS256, pelas chaves do Google), `iss`, `aud` (o nosso cliente), `exp` (com 60 s de
 * tolerância de relógio), `nonce` (o do fluxo, em tempo constante), `sub` e e-mail presentes. `email_verified` NÃO recusa
 * aqui: volta como dado e a decisão (regra 10) o recusa. Qualquer falha é `GoogleTokenError`.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  i: { clientId: string; nonce: string; now: Date; keys: JWTVerifyGetKey },
): Promise<GoogleIdentity> {
  try {
    const { payload } = await jwtVerify(idToken, i.keys, {
      issuer: EMISSORES,
      audience: i.clientId,
      algorithms: ['RS256'],
      currentDate: i.now,
      clockTolerance: 60,
      requiredClaims: ['exp', 'iat', 'sub'],
    })
    if (typeof payload.nonce !== 'string' || i.nonce === '' || !iguais(payload.nonce, i.nonce)) throw new GoogleTokenError()
    if (typeof payload.sub !== 'string' || payload.sub === '' || payload.sub.length > 255) throw new GoogleTokenError()
    if (typeof payload.email !== 'string') throw new GoogleTokenError()
    const email = normalizeEmail(payload.email)
    // O Google manda booleano; aceitar o texto "true" só por tolerância. Qualquer outra coisa vale como não verificado.
    const verificado = payload.email_verified === true || payload.email_verified === 'true'
    const nome = typeof payload.name === 'string' && payload.name.trim() !== '' ? payload.name.trim().slice(0, 120) : null
    return { sub: payload.sub, email, emailVerified: verificado, name: nome }
  } catch (err) {
    throw err instanceof GoogleTokenError ? err : new GoogleTokenError()
  }
}
