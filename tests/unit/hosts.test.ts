import { describe, expect, test } from 'vitest'
import { areaUrl, resolveArea, routeRequest } from '@/server/hosts'

const cfg = { dev: 'dev.localhost:3000', painel: 'painel.localhost:3000', api: 'api.localhost:3000' }

describe('hosts', () => {
  test('reconhece os três hosts sem diferenciar maiúsculas', () => {
    expect(resolveArea('DEV.localhost:3000', cfg)).toBe('dev')
    expect(resolveArea('painel.localhost:3000', cfg)).toBe('painel')
    expect(resolveArea('api.localhost:3000.', cfg)).toBe('api')
  })
  test('host desconhecido, vazio ou ausente não é área nenhuma', () => {
    for (const h of ['localhost:3000', '127.0.0.1:3000', 'evil.com', 'dev.localhost', '', null, undefined])
      expect(resolveArea(h, cfg)).toBeNull()
  })
  test('reescreve para a área do host', () => {
    expect(routeRequest('dev.localhost:3000', '/contas', cfg)).toEqual({ action: 'rewrite', to: '/dev/contas' })
    expect(routeRequest('painel.localhost:3000', '/', cfg)).toEqual({ action: 'rewrite', to: '/painel' })
    expect(routeRequest('api.localhost:3000', '/v1/health', cfg)).toEqual({ action: 'rewrite', to: '/api/v1/health' })
  })
  test('um host não alcança a área de outro', () => {
    expect(routeRequest('painel.localhost:3000', '/dev/contas', cfg)).toEqual({ action: 'not_found' })
    expect(routeRequest('dev.localhost:3000', '/painel', cfg)).toEqual({ action: 'not_found' })
    expect(routeRequest('painel.localhost:3000', '/api/v1/health', cfg)).toEqual({ action: 'not_found' })
  })
  test('caminho parecido com prefixo interno não é barrado', () => {
    expect(routeRequest('painel.localhost:3000', '/devolucoes', cfg)).toEqual({ action: 'rewrite', to: '/painel/devolucoes' })
  })
  test('host desconhecido é 404; estáticos passam em host conhecido', () => {
    expect(routeRequest('localhost:3000', '/', cfg)).toEqual({ action: 'not_found' })
    expect(routeRequest('dev.localhost:3000', '/_next/static/x.js', cfg)).toEqual({ action: 'pass' })
    expect(routeRequest('painel.localhost:3000', '/arquivos/a/b.webp', cfg)).toEqual({ action: 'pass' })
    expect(routeRequest('dev.localhost:3000', '/favicon.ico', cfg)).toEqual({ action: 'pass' })
  })
  test('arquivos estáticos de public/ (/brand/...) passam nos três hosts, sem reescrita', () => {
    for (const h of [cfg.dev, cfg.painel, cfg.api])
      for (const p of ['/brand/agendaflui-horizontal.svg', '/brand/agendaflui-simbolo.svg'])
        expect(routeRequest(h, p, cfg)).toEqual({ action: 'pass' })
    expect(routeRequest('evil.com', '/brand/agendaflui-horizontal.svg', cfg)).toEqual({ action: 'not_found' })
  })
  test('/healthz passa em qualquer host: conhecido, desconhecido ou ausente', () => {
    for (const h of ['dev.localhost:3000', 'localhost:3000', '127.0.0.1:3000', 'evil.com', '', null, undefined])
      expect(routeRequest(h, '/healthz', cfg)).toEqual({ action: 'pass' })
  })
  test('só o caminho exato /healthz é liberado para host desconhecido', () => {
    for (const p of ['/healthz/', '/healthz/x', '/healthzz', '/HEALTHZ', '/x/healthz'])
      expect(routeRequest('evil.com', p, cfg)).toEqual({ action: 'not_found' })
  })
  test('barra final preserva o caminho', () => {
    expect(routeRequest('dev.localhost:3000', '/contas/', cfg)).toEqual({ action: 'rewrite', to: '/dev/contas/' })
  })
  test('maiúsculas e codificação não escapam para outra área', () => {
    for (const p of ['/DEV/contas', '/%64ev/contas', '/%44eV/contas', '/Painel', '/%61pi/v1', '/%zz'])
      expect(routeRequest('painel.localhost:3000', p, cfg)).toEqual({ action: 'not_found' })
  })
  test('areaUrl monta a URL da área', () => {
    expect(areaUrl('painel', '/entrar/minha-loja', cfg, 'http')).toBe('http://painel.localhost:3000/entrar/minha-loja')
    expect(areaUrl('api', '/v1', cfg, 'https')).toBe('https://api.localhost:3000/v1')
  })
  test('areaUrl recusa caminho sem barra inicial, para o host não se misturar com o caminho', () => {
    expect(() => areaUrl('painel', 'entrar', cfg, 'http')).toThrow(/barra/)
    expect(() => areaUrl('painel', '', cfg, 'http')).toThrow(/barra/)
    expect(() => areaUrl('painel', '.evil.com/x', cfg, 'http')).toThrow(/barra/)
    expect(areaUrl('painel', '/', cfg, 'http')).toBe('http://painel.localhost:3000/')
  })
})
