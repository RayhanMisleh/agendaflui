import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { proxy } from '@/proxy'

beforeEach(() => {
  vi.stubEnv('APP_HOST', 'app.test')
  vi.stubEnv('DEV_HOST', 'dev.test')
  vi.stubEnv('LEGACY_PAINEL_HOST', 'painel.test')
})
afterEach(() => vi.unstubAllEnvs())

test('link antigo do painel vira 308 no host do app, com a consulta', () => {
  const r = proxy(new NextRequest('http://painel.test/definir-senha/t?a=1', { headers: { host: 'painel.test' } }))
  expect(r.status).toBe(308)
  expect(r.headers.get('location')).toBe('http://app.test/convite/t?a=1')
})

test('/healthz responde em qualquer host e host desconhecido é 404', () => {
  const ok = proxy(new NextRequest('http://x.test/healthz', { headers: { host: 'x.test' } }))
  expect(ok.headers.get('x-middleware-rewrite')).toBeNull()
  expect(ok.status).toBe(200)
  const nao = proxy(new NextRequest('http://x.test/entrar', { headers: { host: 'x.test' } }))
  expect(nao.headers.get('x-middleware-rewrite')).toContain('/_nao-encontrado')
})

test('/_next do endereço antigo é 404 (não redireciona)', () => {
  const r = proxy(new NextRequest('http://painel.test/_next/static/x.js', { headers: { host: 'painel.test' } }))
  expect(r.status).not.toBe(308)
  expect(r.headers.get('x-middleware-rewrite')).toContain('/_nao-encontrado')
})
