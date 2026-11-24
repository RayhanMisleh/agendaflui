import { beforeEach, describe, expect, test } from 'vitest'
import { SignJWT } from 'jose'
import { createHash, hkdfSync } from 'node:crypto'
import { GOOGLE_FLOW_COOKIE, googleRedirectUri, readGoogleFlow, startGoogleFlow } from '@/server/auth/google/flow'
import type { GoogleIntent } from '@/server/auth/google/flow'
import { saveGoogleSettings } from '@/server/domain/platform/google-settings'
import { env } from '@/server/env'
import { resetDb } from '../setup/db'
import { makePlatformAdmin } from '../setup/factories'

const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const SEGREDO = 'GOCSPX-abcdef0123456789Qz7K'
const NOW = new Date('2026-11-23T15:00:00Z')
const TOKEN_CONVITE = 'tok-convite-secreto-0123456789'

async function ligar(): Promise<void> {
  const a = await makePlatformAdmin()
  await saveGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name }, { clientId: ID, clientSecret: SEGREDO }, 0, NOW)
}

beforeEach(async () => {
  await resetDb()
})

describe('startGoogleFlow', () => {
  test('sem chaves: null', async () => {
    expect(await startGoogleFlow({ kind: 'sign_in' }, NOW)).toBeNull()
  })

  test('URL com response_type=code, client_id, redirect_uri, scope, state, nonce, code_challenge S256 e prompt=select_account', async () => {
    await ligar()
    const r = await startGoogleFlow({ kind: 'sign_in' }, NOW)
    expect(r).not.toBeNull()
    const url = new URL(r?.url ?? '')
    const p = url.searchParams
    expect(`${url.origin}${url.pathname}`).toBe('http://app.localhost:3000/google/falso')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe(ID)
    expect(p.get('redirect_uri')).toBe(googleRedirectUri())
    expect(googleRedirectUri()).toBe(`http://${env.APP_HOST}/google/retorno`)
    expect(p.get('scope')).toBe('openid email profile')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('prompt')).toBe('select_account')
    const fluxo = await readGoogleFlow(r?.cookie, NOW)
    expect(fluxo).not.toBeNull()
    expect(p.get('state')).toBe(fluxo?.state)
    expect(p.get('nonce')).toBe(fluxo?.nonce)
    expect(p.get('code_challenge')).toBe(createHash('sha256').update(fluxo?.verifier ?? '').digest('base64url'))
    expect(fluxo?.verifier.length).toBeGreaterThanOrEqual(43)
    expect(GOOGLE_FLOW_COOKIE).toBe('af_google')
  })

  test('cada início tem state, nonce e verifier novos', async () => {
    await ligar()
    const a = await readGoogleFlow((await startGoogleFlow({ kind: 'sign_in' }, NOW))?.cookie, NOW)
    const b = await readGoogleFlow((await startGoogleFlow({ kind: 'sign_in' }, NOW))?.cookie, NOW)
    expect(a?.state).not.toBe(b?.state)
    expect(a?.nonce).not.toBe(b?.nonce)
    expect(a?.verifier).not.toBe(b?.verifier)
  })

  test('a intenção viaja no cookie e nunca na URL', async () => {
    await ligar()
    const intencoes: GoogleIntent[] = [
      { kind: 'invite', token: TOKEN_CONVITE },
      { kind: 'store_signup', slug: 'minha-loja' },
      { kind: 'link' },
    ]
    for (const intent of intencoes) {
      const r = await startGoogleFlow(intent, NOW)
      expect(r?.url).not.toContain(TOKEN_CONVITE)
      expect(r?.url).not.toContain('minha-loja')
      expect(r?.url).not.toContain('invite')
      expect((await readGoogleFlow(r?.cookie, NOW))?.intent).toEqual(intent)
    }
  })

  test('o cookie assinado não esconde nada em claro além do JWT (a assinatura vale)', async () => {
    await ligar()
    const r = await startGoogleFlow({ kind: 'sign_in' }, NOW)
    expect(r?.cookie.split('.')).toHaveLength(3)
  })
})

describe('readGoogleFlow', () => {
  test('cookie adulterado, vencido, de versão ou intenção desconhecida: null', async () => {
    await ligar()
    const r = await startGoogleFlow({ kind: 'sign_in' }, NOW)
    const cookie = r?.cookie ?? ''
    expect(await readGoogleFlow(undefined, NOW)).toBeNull()
    expect(await readGoogleFlow('', NOW)).toBeNull()
    expect(await readGoogleFlow(`${cookie.slice(0, -3)}AAA`, NOW)).toBeNull()
    expect(await readGoogleFlow(cookie, new Date(NOW.getTime() + 11 * 60 * 1000))).toBeNull()
    expect(await readGoogleFlow(cookie, new Date(NOW.getTime() + 5 * 60 * 1000))).not.toBeNull()

    const chave = Buffer.from(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/google-flow/v1', 32))
    const assinar = (p: Record<string, unknown>) =>
      new SignJWT(p)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 600)
        .sign(chave)
    const base = { state: 's'.repeat(20), nonce: 'n'.repeat(20), verifier: 'v'.repeat(43) }
    expect(await readGoogleFlow(await assinar({ v: 1, ...base, intent: { kind: 'sign_in' } }), NOW)).not.toBeNull()
    expect(await readGoogleFlow(await assinar({ v: 2, ...base, intent: { kind: 'sign_in' } }), NOW)).toBeNull()
    expect(await readGoogleFlow(await assinar({ v: 1, ...base, intent: { kind: 'apagar_tudo' } }), NOW)).toBeNull()
    expect(await readGoogleFlow(await assinar({ v: 1, ...base, intent: { kind: 'store_signup' } }), NOW)).toBeNull()
    // Assinado com outra chave (ou "none"): recusa.
    const outra = await new SignJWT({ v: 1, ...base, intent: { kind: 'sign_in' } })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 600)
      .sign(createHash('sha256').update('outra').digest())
    expect(await readGoogleFlow(outra, NOW)).toBeNull()
  })
})
