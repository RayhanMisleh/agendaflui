import {
  ALLOWED_HEADERS,
  appWebOrigins,
  corsHeaders,
  isLocalOrigin,
  isSyntacticOrigin,
  originAllowed,
  preflightHeaders,
  webOriginsFromEnv,
  type WebOrigins,
} from '@/server/api/cors'

const lista: WebOrigins = { origins: ['https://app.exemplo.com', 'https://app.exemplo.com:8443'], allowLocalhost: false }
const comLocal: WebOrigins = { ...lista, allowLocalhost: true }

describe('webOriginsFromEnv', () => {
  test('lê a lista separada por vírgula, tira espaços, barra final e repetidas, e põe em minúsculas', () => {
    const cfg = webOriginsFromEnv({ NODE_ENV: 'production', APP_WEB_ORIGINS: ' https://App.Exemplo.com/ , https://b.exemplo.com,,https://app.exemplo.com ' })
    expect(cfg.origins).toEqual(['https://app.exemplo.com', 'https://b.exemplo.com'])
  })

  test('sem APP_WEB_ORIGINS a lista é vazia', () => {
    expect(webOriginsFromEnv({ NODE_ENV: 'production' }).origins).toEqual([])
    expect(webOriginsFromEnv({ NODE_ENV: 'production', APP_WEB_ORIGINS: '' }).origins).toEqual([])
  })

  test('localhost só fora de produção', () => {
    expect(webOriginsFromEnv({ NODE_ENV: 'production' }).allowLocalhost).toBe(false)
    for (const ambiente of ['development', 'test', undefined]) {
      expect(webOriginsFromEnv({ NODE_ENV: ambiente }).allowLocalhost, String(ambiente)).toBe(true)
    }
  })
})

describe('appWebOrigins', () => {
  test('lê o ambiente do processo (nos testes, NODE_ENV é test: localhost liberado)', () => {
    const antes = process.env.APP_WEB_ORIGINS
    process.env.APP_WEB_ORIGINS = 'https://app.exemplo.com'
    try {
      expect(appWebOrigins()).toEqual({ origins: ['https://app.exemplo.com'], allowLocalhost: true })
    } finally {
      if (antes === undefined) delete process.env.APP_WEB_ORIGINS
      else process.env.APP_WEB_ORIGINS = antes
    }
  })
})

describe('originAllowed', () => {
  test('casa a origem da lista exatamente (ignora maiúsculas)', () => {
    expect(originAllowed('https://app.exemplo.com', lista)).toBe(true)
    expect(originAllowed('https://app.exemplo.com:8443', lista)).toBe(true)
    expect(originAllowed('https://APP.exemplo.com', lista)).toBe(true)
  })

  test('não casa origem parecida: outro esquema, porta, subdomínio ou sufixo; nem texto que não é origem', () => {
    expect(originAllowed('http://app.exemplo.com', lista)).toBe(false)
    expect(originAllowed('https://app.exemplo.com:9000', lista)).toBe(false)
    expect(originAllowed('https://x.app.exemplo.com', lista)).toBe(false)
    expect(originAllowed('https://app.exemplo.com.evil.com', lista)).toBe(false)
    expect(originAllowed('https://evilapp.exemplo.com', lista)).toBe(false)
    expect(originAllowed('https://app.exemplo.com/caminho', lista)).toBe(false)
    expect(originAllowed('null', lista)).toBe(false)
    expect(originAllowed('', lista)).toBe(false)
  })

  test('lista vazia e allowLocalhost falso: nada passa, nem localhost', () => {
    const vazia: WebOrigins = { origins: [], allowLocalhost: false }
    expect(originAllowed('https://app.exemplo.com', vazia)).toBe(false)
    expect(originAllowed('http://localhost:5173', vazia)).toBe(false)
  })

  test('allowLocalhost libera localhost, *.localhost, 127.0.0.1 e [::1] em qualquer porta', () => {
    for (const o of ['http://localhost:5173', 'http://localhost', 'http://loja.localhost:3000', 'http://a.b.localhost:1', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'https://localhost:3443']) {
      expect(originAllowed(o, comLocal), o).toBe(true)
    }
  })

  test('allowLocalhost falso recusa localhost mesmo com a lista preenchida', () => {
    for (const o of ['http://localhost:5173', 'http://loja.localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:3000']) {
      expect(originAllowed(o, lista), o).toBe(false)
    }
  })

  test('imitações de localhost não passam nem com allowLocalhost', () => {
    for (const o of ['http://localhost.evil.com:5173', 'http://loja.localhost.evil.com', 'http://evil-localhost:5173', 'http://.localhost:5173', 'http://evil.com/.localhost:5173', 'http://a@evil.com:5173/.localhost:5173', 'http://127.0.0.1.evil.com']) {
      expect(originAllowed(o, comLocal), o).toBe(false)
    }
  })

  test('uma origem da lista continua valendo com allowLocalhost', () => {
    expect(originAllowed('https://app.exemplo.com', comLocal)).toBe(true)
  })
})

describe('isLocalOrigin', () => {
  test('reconhece as origens da própria máquina e só elas', () => {
    for (const o of ['http://localhost:3000', 'http://x.localhost:3000', 'http://127.0.0.1', 'http://[::1]:5173']) expect(isLocalOrigin(o), o).toBe(true)
    for (const o of ['https://app.exemplo.com', 'http://localhost.evil.com', 'localhost', 'http://localhost/x', 'http://a..localhost:5173', 'http://-a.localhost', '']) expect(isLocalOrigin(o), o).toBe(false)
  })
})

describe('isSyntacticOrigin', () => {
  test('aceita http e https com host e porta opcional', () => {
    for (const o of ['https://app.exemplo.com', 'http://localhost:3000', 'http://[::1]:3000', 'http://a.localhost']) {
      expect(isSyntacticOrigin(o), o).toBe(true)
    }
  })

  test('recusa o que não é origem (inclusive curinga)', () => {
    for (const o of ['null', '', '*', 'ftp://a.com', 'https://a.com/caminho', 'https://a.com?x=1', 'https://usuario@a.com', 'a.com', 'https://', 'https://a b.com', 'http://*.localhost:5173']) {
      expect(isSyntacticOrigin(o), o).toBe(false)
    }
    expect(isSyntacticOrigin(`https://${'a'.repeat(400)}.com`)).toBe(false)
  })
})

describe('cabeçalhos', () => {
  test('o pré-voo anuncia x-business e não x-app-key; nunca credenciais nem *', () => {
    const h = preflightHeaders('https://app.exemplo.com')
    expect(h['access-control-allow-origin']).toBe('https://app.exemplo.com')
    expect(h['access-control-allow-headers']).toContain('x-business')
    expect(h['access-control-allow-headers']).not.toContain('x-app-key')
    expect(ALLOWED_HEADERS).not.toContain('x-app-key')
    expect(h['access-control-allow-credentials']).toBeUndefined()
    expect(h.vary).toBe('Origin')
  })

  test('a resposta real ecoa a origem e expõe Retry-After e X-Request-Id', () => {
    const h = corsHeaders('https://app.exemplo.com')
    expect(h['access-control-allow-origin']).toBe('https://app.exemplo.com')
    expect(h['access-control-expose-headers']).toContain('retry-after')
    expect(h['access-control-expose-headers']).toContain('x-request-id')
    expect(h.vary).toBe('Origin')
  })
})
