import { beforeEach, describe, expect, test, vi } from 'vitest'
import { readGoogleFlow } from '@/server/auth/google/flow'
import { issueInvite } from '@/server/auth/invites'
import { prisma } from '@/server/db/client'
import { saveGoogleSettings } from '@/server/domain/platform/google-settings'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin, makeUser } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      if (options['maxAge'] === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
  headers: async () => new Headers(),
}))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { POST } from '@/app/app/google/entrar/route'
import { GET } from '@/app/app/google/retorno/route'

const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const HOST = 'app.localhost:3000'
const google = fakeGoogleAuthority()

function post(campos: Record<string, string>, headers: Record<string, string> = { host: HOST, origin: `http://${HOST}` }): Request {
  const body = new URLSearchParams(campos)
  return new Request(`http://${HOST}/google/entrar`, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body })
}

beforeEach(async () => {
  jar.clear()
  google.reset()
  await resetDb()
  const a = await makePlatformAdmin()
  await saveGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name }, { clientId: ID, clientSecret: 'GOCSPX-abcdef0123456789Qz7K' }, 0, new Date())
})

describe('POST /google/entrar', () => {
  test('sem Origin do host: 403 e nenhum cookie', async () => {
    const r = await POST(post({ fluxo: 'entrar' }, { host: HOST }))
    expect(r.status).toBe(403)
    expect(r.headers.get('set-cookie')).toBeNull()
    const r2 = await POST(post({ fluxo: 'entrar' }, { host: HOST, origin: 'https://site-ruim.example' }))
    expect(r2.status).toBe(403)
  })

  test('fluxo=convite: cookie af_google HttpOnly, SameSite=Lax, Path=/google, Max-Age=600 e 303 para o endpoint do Google', async () => {
    const u = await makeUser({ password: null })
    const { token } = await prisma.$transaction((tx) => issueInvite(tx, u.id, new Date()))
    const r = await POST(post({ fluxo: 'convite', convite: token }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/^http:\/\/app\.localhost:3000\/google\/falso\?/)
    expect(r.headers.get('location')).not.toContain(token)
    const c = r.headers.get('set-cookie') ?? ''
    expect(c).toMatch(/^af_google=/)
    for (const parte of ['HttpOnly', 'SameSite=Lax', 'Path=/google', 'Max-Age=600']) expect(c).toContain(parte)
    expect((await readGoogleFlow(c.split(';')[0]?.slice('af_google='.length), new Date()))?.intent).toEqual({ kind: 'invite', token })
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  test('loja inexistente e convite inválido voltam à tela de origem sem ir ao Google', async () => {
    const a = await POST(post({ fluxo: 'loja', slug: 'nao-existe' }))
    expect(a.status).toBe(303)
    expect(a.headers.get('location')).toBe('/nao-existe/entrar?google=store_unavailable')
    expect(a.headers.get('set-cookie')).toBeNull()
    const b = await POST(post({ fluxo: 'convite', convite: 'lixo' }))
    expect(b.headers.get('location')).toBe('/convite/lixo?google=invite_invalid')
  })

  test('sem chaves: volta a /entrar?google=not_configured', async () => {
    await prisma.platformSetting.deleteMany()
    const r = await POST(post({ fluxo: 'entrar' }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/entrar?google=not_configured')
  })
})

describe('GET /google/retorno', () => {
  test('sucesso grava af_session, apaga af_google e responde 303', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    const inicio = await POST(post({ fluxo: 'loja', slug: b.slug }))
    const cookie = (inicio.headers.get('set-cookie') ?? '').split(';')[0]?.slice('af_google='.length) ?? ''
    const fluxo = await readGoogleFlow(cookie, new Date())
    const code = await google.issueCode({ sub: 'g-1', email: 'ana@exemplo.test', name: 'Ana', nonce: fluxo?.nonce ?? '' })
    jar.set('af_google', cookie)
    const r = await GET(new Request(`http://${HOST}/google/retorno?code=${code}&state=${fluxo?.state}`))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/pet-bom')
    expect(jar.has('af_session')).toBe(true)
    const apagar = r.headers.get('set-cookie') ?? ''
    expect(apagar).toMatch(/^af_google=;/)
    expect(apagar).toContain('Max-Age=0')
    expect(apagar).toContain('Path=/google')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  })

  test('falha não grava sessão e volta com o motivo', async () => {
    const r = await GET(new Request(`http://${HOST}/google/retorno?code=x&state=y`))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/entrar?google=flow_invalid')
    expect(jar.has('af_session')).toBe(false)
  })
})
