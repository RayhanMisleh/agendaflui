import { hkdfSync } from 'node:crypto'
import { SignJWT } from 'jose'

/** Chave HS256 real do servidor (mesma derivação), para forjar tokens com defeitos pontuais nos testes. */
export function realKey(): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', process.env.APP_SECRET ?? '', '', 'agendaflui/api-access/v1', 32))
}

type Forge = {
  sub?: string | null
  payload?: Record<string, unknown>
  alg?: string
  typ?: string | null
  iat?: number | null
  exp?: number | null
  key?: Uint8Array
}

/** Token com as declarações certas, trocando só o que o caso pede (`null` remove o campo). */
export async function forge(now: Date, uuids: { sub: string; bid: string }, f: Forge = {}): Promise<string> {
  const seg = Math.floor(now.getTime() / 1000)
  const header: Record<string, unknown> = { alg: f.alg ?? 'HS256' }
  if (f.typ !== null) header.typ = f.typ ?? 'at+jwt'
  let jwt = new SignJWT({ bid: uuids.bid, knd: 'customer', ...f.payload })
    .setProtectedHeader(header as { alg: string })
    .setIssuer('agendaflui')
    .setAudience('api')
  if (f.sub !== null) jwt = jwt.setSubject(f.sub ?? uuids.sub)
  if (f.iat !== null) jwt = jwt.setIssuedAt(f.iat ?? seg)
  if (f.exp !== null) jwt = jwt.setExpirationTime(f.exp ?? seg + 900)
  return jwt.sign(f.key ?? realKey())
}
