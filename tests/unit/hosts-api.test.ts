import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { describe, expect, test } from 'vitest'
import { proxy } from '@/proxy'
import { routeRequest } from '@/server/hosts'

const cfg = { dev: 'dev.localhost:3000', painel: 'painel.localhost:3000', api: 'api.localhost:3000' }

describe('roteamento da API por host', () => {
  test('/v1/health no host da API vai para /api/v1/health', () => {
    expect(routeRequest('api.localhost:3000', '/v1/health', cfg)).toEqual({ action: 'rewrite', to: '/api/v1/health' })
  })

  test('/api/v1/health pedido direto pelo prefixo interno é 404, em qualquer host', () => {
    for (const host of [cfg.api, cfg.painel, cfg.dev]) {
      expect(routeRequest(host, '/api/v1/health', cfg)).toEqual({ action: 'not_found' })
    }
  })

  test('host desconhecido é 404', () => {
    for (const host of ['localhost:3000', 'api.exemplo.com', '127.0.0.1:3000', null]) {
      expect(routeRequest(host, '/v1/health', cfg)).toEqual({ action: 'not_found' })
    }
  })

  test('no host do painel, /v1/health vira /painel/v1/health, que não existe (404 do Next)', () => {
    expect(routeRequest('painel.localhost:3000', '/v1/health', cfg)).toEqual({ action: 'rewrite', to: '/painel/v1/health' })
    const painel = join(process.cwd(), 'src/app/painel')
    expect(existsSync(join(painel, 'v1'))).toBe(false)
    // Nenhum segmento dinâmico na raiz do painel poderia atender /painel/v1/...
    expect(readdirSync(painel).filter((n) => n.startsWith('['))).toEqual([])
  })

  test('o proxy aplica a decisão: reescreve a API e manda o resto para a página de 404', () => {
    const pedir = (host: string, caminho: string) =>
      proxy(new NextRequest(`http://${host}${caminho}`, { headers: { host } })).headers.get('x-middleware-rewrite')
    expect(pedir(cfg.api, '/v1/health')).toBe(`http://${cfg.api}/api/v1/health`)
    expect(pedir(cfg.api, '/api/v1/health')).toContain('/_nao-encontrado')
    expect(pedir('desconhecido.test', '/v1/health')).toContain('/_nao-encontrado')
    expect(pedir(cfg.painel, '/v1/health')).toBe(`http://${cfg.painel}/painel/v1/health`)
  })
})
