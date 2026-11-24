import { describe, expect, test } from 'vitest'
import { DEFAULT_HOSTS, areaUrl, hostConfigFromEnv, legacyPainelPath, resolveArea, routeRequest, type HostConfig, type RouteDecision } from '@/server/hosts'

const cfg: HostConfig = { dev: 'dev.test', app: 'app.test', legacyPainel: 'painel.test' }

const casos: [string | null, string, RouteDecision][] = [
  ['app.test', '/', { action: 'rewrite', to: '/app' }],
  ['app.test', '/painel/agenda', { action: 'rewrite', to: '/app/painel/agenda' }],
  ['app.test', '/demo', { action: 'rewrite', to: '/app/demo' }],
  ['app.test', '/app/painel', { action: 'not_found' }],
  ['app.test', '/%41pp/x', { action: 'not_found' }],
  ['app.test', '/dev', { action: 'not_found' }],
  ['app.test', '/%E0', { action: 'not_found' }],
  ['dev.test', '/contas', { action: 'rewrite', to: '/dev/contas' }],
  ['dev.test', '/app/x', { action: 'not_found' }],
  ['app.test', '/arquivos/a.png', { action: 'pass' }],
  ['x.test', '/healthz', { action: 'pass' }],
  ['x.test', '/entrar', { action: 'not_found' }],
  ['painel.test', '/', { action: 'redirect', path: '/painel' }],
  ['painel.test', '/entrar', { action: 'redirect', path: '/entrar' }],
  ['painel.test', '/esqueci-a-senha', { action: 'redirect', path: '/esqueci-a-senha' }],
  ['painel.test', '/definir-senha/abc', { action: 'redirect', path: '/convite/abc' }],
  ['painel.test', '/redefinir-senha/abc', { action: 'redirect', path: '/redefinir-senha/abc' }],
  ['painel.test', '/clientes/9', { action: 'redirect', path: '/painel/clientes/9' }],
  ['painel.test', '/arquivos/a/b.png', { action: 'redirect', path: '/arquivos/a/b.png' }],
  ['painel.test', '/brand/logo.svg', { action: 'redirect', path: '/brand/logo.svg' }],
  ['painel.test', '/_next/static/x.js', { action: 'not_found' }],
  ['painel.test', '/healthz', { action: 'pass' }],
  ['APP.test.', '/demo', { action: 'rewrite', to: '/app/demo' }],
  ['app.test', '/_next/static/x.js', { action: 'pass' }],
  ['app.test', '/brand/logo.svg', { action: 'pass' }],
  ['app.test', '/favicon.ico', { action: 'pass' }],
  ['app.test', '/demo/', { action: 'rewrite', to: '/app/demo/' }],
  [null, '/', { action: 'not_found' }],
]

describe('routeRequest', () => {
  test.each(casos)('%s %s', (host, caminho, esperado) => {
    expect(routeRequest(host, caminho, cfg)).toEqual(esperado)
  })

  test('sem endereço antigo configurado, o host painel é desconhecido', () => {
    expect(routeRequest('painel.test', '/entrar', { ...cfg, legacyPainel: null })).toEqual({ action: 'not_found' })
  })

  test('só o caminho exato /healthz é liberado para host desconhecido', () => {
    for (const p of ['/healthz/', '/healthz/x', '/healthzz', '/HEALTHZ', '/x/healthz'])
      expect(routeRequest('evil.com', p, cfg)).toEqual({ action: 'not_found' })
  })

  test('maiúsculas e codificação não escapam para outra área', () => {
    for (const p of ['/DEV/contas', '/%64ev/contas', '/%44eV/contas', '/App/x', '/%zz'])
      expect(routeRequest('app.test', p, cfg)).toEqual({ action: 'not_found' })
  })
})

test('resolveArea reconhece os dois hosts sem diferenciar maiúsculas e ignora o antigo', () => {
  expect(resolveArea('DEV.test', cfg)).toBe('dev')
  expect(resolveArea('app.test.', cfg)).toBe('app')
  for (const h of ['painel.test', 'localhost:3000', 'evil.com', '', null, undefined]) expect(resolveArea(h, cfg)).toBeNull()
})

test('legacyPainelPath', () => {
  expect(legacyPainelPath('/')).toBe('/painel')
  expect(legacyPainelPath('/agenda')).toBe('/painel/agenda')
  expect(legacyPainelPath('/_next/x')).toBeNull()
})

describe('areaUrl', () => {
  test('monta a URL da área', () => {
    expect(areaUrl('app', '/entrar', cfg, 'http')).toBe('http://app.test/entrar')
    expect(areaUrl('dev', '/', cfg, 'https')).toBe('https://dev.test/')
  })
  test('recusa caminho sem barra inicial, para o host não se misturar com o caminho', () => {
    for (const p of ['entrar', '', '.evil.com/x']) expect(() => areaUrl('app', p, cfg, 'http')).toThrow(/barra/)
  })
})

describe('hostConfigFromEnv', () => {
  test('sem variáveis usa os padrões locais e nenhum endereço antigo', () => {
    expect(hostConfigFromEnv({})).toEqual({ dev: 'dev.localhost:3000', app: 'app.localhost:3000', legacyPainel: null })
  })
  test('variável vazia também cai no padrão', () => {
    expect(hostConfigFromEnv({ DEV_HOST: '', LEGACY_PAINEL_HOST: '' })).toEqual({ ...DEFAULT_HOSTS, legacyPainel: null })
  })
  test('usa os valores informados', () => {
    expect(hostConfigFromEnv({ DEV_HOST: 'd.exemplo.com', APP_HOST: 'a.exemplo.com', LEGACY_PAINEL_HOST: 'p.exemplo.com' })).toEqual({
      dev: 'd.exemplo.com',
      app: 'a.exemplo.com',
      legacyPainel: 'p.exemplo.com',
    })
  })
})
