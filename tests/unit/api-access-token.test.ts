import { SignJWT } from 'jose'
import { signAccessToken, verifyAccessToken, type AccessClaims } from '@/server/auth/api-tokens'
import { addMinutes, fromEpochMs } from '@/server/time'
import { forge, realKey } from '../setup/access-token'

const now = fromEpochMs(1_800_000_000_000)
const customer: AccessClaims = {
  kind: 'customer',
  businessId: '11111111-1111-4111-8111-111111111111',
  customerId: '22222222-2222-4222-8222-222222222222',
}
const staff: AccessClaims = {
  kind: 'staff',
  businessId: '11111111-1111-4111-8111-111111111111',
  membershipId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
}

function carga(token: string): Record<string, unknown> {
  const parte = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as Record<string, unknown>
}

function chaveDeTeste(): Uint8Array {
  return new TextEncoder().encode('chave-qualquer-de-32-bytes-aqui!!')
}

test('assinar e verificar devolve as mesmas declarações (cliente e equipe)', async () => {
  for (const claims of [customer, staff]) {
    const { token, expiresAt } = await signAccessToken(claims, now)
    expect(expiresAt.getTime()).toBe(addMinutes(now, 15).getTime())
    expect(await verifyAccessToken(token, addMinutes(now, 14))).toEqual(claims)
  }
})

test('a carga só tem ids e metadados do token, sem e-mail, nome nem telefone', async () => {
  const { token } = await signAccessToken(staff, now)
  const c = carga(token)
  expect(Object.keys(c).sort()).toEqual(['aud', 'bid', 'exp', 'iat', 'iss', 'knd', 'sub', 'uid'])
  expect(c).toMatchObject({ iss: 'agendaflui', aud: 'api', knd: 'staff', bid: staff.businessId, sub: 'membershipId' in staff ? staff.membershipId : '' })
  const { token: t2 } = await signAccessToken(customer, now)
  expect(Object.keys(carga(t2)).sort()).toEqual(['aud', 'bid', 'exp', 'iat', 'iss', 'knd', 'sub'])
})

test('vencido (16 min depois) devolve null', async () => {
  const { token } = await signAccessToken(customer, now)
  expect(await verifyAccessToken(token, addMinutes(now, 16))).toBeNull()
})

test('assinatura adulterada devolve null', async () => {
  const { token } = await signAccessToken(customer, now)
  const [h, p, s] = token.split('.') as [string, string, string]
  const troca = s.startsWith('A') ? 'B' : 'A'
  expect(await verifyAccessToken(`${h}.${p}.${troca}${s.slice(1)}`, now)).toBeNull()
  const outra = Buffer.from(JSON.stringify({ ...carga(token), bid: staff.businessId.replace('1', '5') })).toString('base64url')
  expect(await verifyAccessToken(`${h}.${outra}.${s}`, now)).toBeNull()
})

test('alg none devolve null', async () => {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const { token } = await signAccessToken(customer, now)
  const p = token.split('.')[1] ?? ''
  expect(await verifyAccessToken(`${h}.${p}.`, now)).toBeNull()
  expect(await verifyAccessToken(`${h}.${p}`, now)).toBeNull()
})

test('audiência, emissor e chave trocados devolvem null', async () => {
  const base = { bid: customer.businessId, knd: 'customer' }
  const emitir = (iss: string, aud: string, key: Uint8Array) =>
    new SignJWT(base)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(customer.customerId)
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 900)
      .sign(key)
  expect(await verifyAccessToken(await emitir('agendaflui', 'outra', chaveDeTeste()), now)).toBeNull()
  expect(await verifyAccessToken(await emitir('outro', 'api', chaveDeTeste()), now)).toBeNull()
  expect(await verifyAccessToken(await emitir('agendaflui', 'api', chaveDeTeste()), now)).toBeNull()
})

test('assinado com a chave certa mas com declarações fora do formato devolve null', async () => {
  const emitir = (sub: string, extra: Record<string, unknown>) =>
    forge(now, { sub, bid: customer.businessId }, { sub, payload: extra })
  // Controle: com a chave derivada e o formato certo, o token vale.
  expect(await verifyAccessToken(await emitir(customer.customerId, {}), now)).toEqual(customer)
  expect(await verifyAccessToken(await emitir('nao-e-uuid', {}), now)).toBeNull()
  expect(await verifyAccessToken(await emitir(customer.customerId, { bid: 'x' }), now)).toBeNull()
  expect(await verifyAccessToken(await emitir(customer.customerId, { knd: 'admin' }), now)).toBeNull()
  expect(await verifyAccessToken(await emitir(customer.customerId, { knd: 'staff' }), now)).toBeNull()
  expect(await verifyAccessToken(await emitir(customer.customerId, { knd: 'staff', uid: 'x' }), now)).toBeNull()
})

test('lixo devolve null e nunca lança', async () => {
  for (const lixo of ['', 'abc', 'a.b.c', '....', 'x'.repeat(5000), '{}', 'null']) {
    expect(await verifyAccessToken(lixo, now), lixo).toBeNull()
  }
})

describe('validade e cabeçalho obrigatórios', () => {
  const ids = { sub: customer.customerId, bid: customer.businessId }
  const seg = Math.floor(now.getTime() / 1000)

  test('controle: o token forjado com tudo certo vale', async () => {
    expect(await verifyAccessToken(await forge(now, ids), now)).toEqual(customer)
  })
  test('sem exp devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { exp: null }), now)).toBeNull()
  })
  test('sem iat devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { iat: null }), now)).toBeNull()
  })
  test('iat um dia no futuro devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { iat: seg + 86400, exp: seg + 86400 + 900 }), now)).toBeNull()
  })
  test('exp de um ano (vida longa demais) devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { exp: seg + 365 * 86400 }), now)).toBeNull()
  })
  test('typ diferente ou ausente devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { typ: 'JWT' }), now)).toBeNull()
    expect(await verifyAccessToken(await forge(now, ids, { typ: null }), now)).toBeNull()
  })
  test('HS512 com a mesma chave devolve null', async () => {
    expect(await verifyAccessToken(await forge(now, ids, { alg: 'HS512' }), now)).toBeNull()
  })
  test('cabeçalho RS256 devolve null', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'at+jwt' })).toString('base64url')
    const ok = await forge(now, ids)
    expect(await verifyAccessToken(`${h}.${ok.split('.')[1]}.${ok.split('.')[2]}`, now)).toBeNull()
  })
  test('customer com uid devolve null', async () => {
    const uid = '44444444-4444-4444-8444-444444444444'
    expect(await verifyAccessToken(await forge(now, ids, { payload: { uid } }), now)).toBeNull()
  })
  test('o token emitido leva typ at+jwt', async () => {
    const { token } = await signAccessToken(customer, now)
    const h = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
    expect(h).toEqual({ alg: 'HS256', typ: 'at+jwt' })
    expect(realKey()).toHaveLength(32)
  })
})
