import { createHash } from 'node:crypto'
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose'
import { describe, expect, test } from 'vitest'
import { GoogleTokenError, verifyGoogleIdToken } from '@/server/auth/google/id-token'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'

const CLIENT = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const NOW = new Date('2026-11-23T15:00:00Z')
const ep = (d: Date): number => Math.floor(d.getTime() / 1000)
const google = fakeGoogleAuthority()

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { aud: CLIENT, sub: 'g-1', email: 'Ana@Exemplo.com', email_verified: true, nonce: 'n-1', iat: ep(NOW), exp: ep(NOW) + 3600, ...extra }
}

const verify = (token: string, over: Partial<{ nonce: string; clientId: string; now: Date }> = {}) =>
  verifyGoogleIdToken(token, { clientId: CLIENT, nonce: 'n-1', now: NOW, keys: google.keys(), ...over })

describe('verifyGoogleIdToken', () => {
  test('válido devolve sub e e-mail em minúsculas', async () => {
    const t = await google.sign(valid({ name: 'Ana Souza' }))
    expect(await verify(t)).toEqual({ sub: 'g-1', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana Souza' })
  })

  test('assinado por outra chave: recusa', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const t = await new SignJWT(valid({ iss: 'https://accounts.google.com' })).setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('chave própria com o mesmo kid mas outra chave: recusa', async () => {
    const par = await generateKeyPair('RS256', { extractable: true })
    const jwk = { ...(await exportJWK(par.publicKey)), kid: 'k', alg: 'RS256' }
    const t = await new SignJWT(valid({ iss: 'https://accounts.google.com' })).setProtectedHeader({ alg: 'RS256', kid: 'outra' }).sign(par.privateKey)
    await expect(verify(t, {})).rejects.toBeInstanceOf(GoogleTokenError)
    // Com o conjunto certo da outra chave valeria: confirma que o teste acima falha pela chave e não por outro motivo.
    await expect(verifyGoogleIdToken(t, { clientId: CLIENT, nonce: 'n-1', now: NOW, keys: createLocalJWKSet({ keys: [{ ...jwk, kid: 'outra' }] }) })).resolves.toMatchObject({ sub: 'g-1' })
  })

  test('algoritmo "none" ou HS256: recusa', async () => {
    const hs = await new SignJWT(valid({ iss: 'https://accounts.google.com' })).setProtectedHeader({ alg: 'HS256' }).sign(createHash('sha256').update('x').digest())
    await expect(verify(hs)).rejects.toBeInstanceOf(GoogleTokenError)
    const nenhum = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(valid({ iss: 'https://accounts.google.com' }))).toString('base64url')}.`
    await expect(verify(nenhum)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('aud de outro cliente: recusa', async () => {
    const t = await google.sign(valid({ aud: '999-outro.apps.googleusercontent.com' }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('iss que não é do Google: recusa', async () => {
    const t = await google.sign(valid({ iss: 'https://evil.example.com' }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('as duas formas do iss do Google valem', async () => {
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
      expect(await verify(await google.sign(valid({ iss })))).toMatchObject({ sub: 'g-1' })
    }
  })

  test('vencido: recusa', async () => {
    const t = await google.sign(valid({ exp: ep(NOW) - 600 }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('nonce de outro fluxo: recusa', async () => {
    const t = await google.sign(valid({ nonce: 'n-outro' }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
    await expect(verify(await google.sign(valid({ nonce: undefined })))).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('sem e-mail: recusa', async () => {
    const t = await google.sign(valid({ email: undefined }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('sem sub: recusa', async () => {
    const t = await google.sign(valid({ sub: undefined }))
    await expect(verify(t)).rejects.toBeInstanceOf(GoogleTokenError)
  })

  test('email_verified falso volta emailVerified false (a decisão recusa)', async () => {
    const t = await google.sign(valid({ email_verified: false }))
    expect((await verify(t)).emailVerified).toBe(false)
    const ausente = await google.sign(valid({ email_verified: undefined }))
    expect((await verify(ausente)).emailVerified).toBe(false)
  })

  test('a mensagem do erro não traz o token', async () => {
    const t = await google.sign(valid({ aud: 'outro' }))
    const e = await verify(t).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GoogleTokenError)
    expect(String((e as Error).message)).not.toContain(t)
  })
})
