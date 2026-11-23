import { migrationDatabaseUrl, parseEnv, productionWarnings, runtimeDatabaseUrl } from '@/server/env'

const ok = { DATABASE_URL: 'postgres://u:p@localhost:5432/d', APP_SECRET: 'x'.repeat(32) }
const hostsDeProducao = { DEV_HOST: 'dev.exemplo.com', PAINEL_HOST: 'painel.exemplo.com', API_HOST: 'api.exemplo.com' }

test('aplica os padrões de host', () => {
  const env = parseEnv(ok)
  expect(env.DEV_HOST).toBe('dev.localhost:3000')
  expect(env.PAINEL_HOST).toBe('painel.localhost:3000')
  expect(env.API_HOST).toBe('api.localhost:3000')
  expect(env.STORAGE_DIR).toBe('.local/storage')
})

test('erro nomeia a variável que falta', () => {
  expect(() => parseEnv({ APP_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/)
})

test('recusa APP_SECRET curto', () => {
  expect(() => parseEnv({ ...ok, APP_SECRET: 'curto' })).toThrow(/APP_SECRET/)
})

test('TRUSTED_PROXY_HOPS: padrão 0, aceita 0 a 5 e recusa o resto', () => {
  expect(parseEnv(ok).TRUSTED_PROXY_HOPS).toBe(0)
  expect(parseEnv({ ...ok, TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS).toBe(2)
  for (const v of ['-1', '6', '1.5', 'abc']) {
    expect(() => parseEnv({ ...ok, TRUSTED_PROXY_HOPS: v }), v).toThrow(/TRUSTED_PROXY_HOPS/)
  }
})

test('em produção recusa o APP_SECRET de exemplo sem imprimir o valor', () => {
  const exemplo = 'EXEMPLO-troque-este-valor-por-um-segredo-aleatorio-de-32-ou-mais'
  let mensagem = ''
  try {
    parseEnv({ ...ok, NODE_ENV: 'production', APP_SECRET: exemplo })
  } catch (e) {
    mensagem = e instanceof Error ? e.message : String(e)
  }
  expect(mensagem).toMatch(/APP_SECRET/)
  expect(mensagem).not.toContain(exemplo)
  expect(parseEnv({ ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }).NODE_ENV).toBe('production')
  expect(parseEnv({ ...ok, NODE_ENV: 'development', APP_SECRET: exemplo }).APP_SECRET).toBe(exemplo)
  expect(parseEnv({ ...ok, NODE_ENV: 'test', APP_SECRET: exemplo }).APP_SECRET).toBe(exemplo)
})

test('em produção com o segredo de exemplo, a fase de build do Next aceita e a execução recusa', () => {
  const exemplo = 'EXEMPLO-troque-este-valor-por-um-segredo-aleatorio-de-32-ou-mais'
  const prod = { ...ok, NODE_ENV: 'production', APP_SECRET: exemplo }
  expect(parseEnv({ ...prod, NEXT_PHASE: 'phase-production-build' }).APP_SECRET).toBe(exemplo)
  expect(() => parseEnv({ ...prod, NEXT_PHASE: 'phase-production-server' })).toThrow(/APP_SECRET/)
  expect(() => parseEnv(prod)).toThrow(/APP_SECRET/)
})

test('em produção com SMTP_URL, MAIL_FROM precisa ser informado; a fase de build e os outros ambientes dispensam', () => {
  const prod = { ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40), SMTP_URL: 'smtp://localhost:2525' }
  expect(() => parseEnv(prod)).toThrow(/MAIL_FROM/)
  expect(parseEnv({ ...prod, MAIL_FROM: 'Conta <contato@exemplo.com>' }).MAIL_FROM).toBe('Conta <contato@exemplo.com>')
  expect(parseEnv({ ...prod, NEXT_PHASE: 'phase-production-build' }).NODE_ENV).toBe('production')
  expect(parseEnv({ ...prod, SMTP_URL: undefined }).NODE_ENV).toBe('production')
  expect(parseEnv({ ...prod, NODE_ENV: 'development' }).NODE_ENV).toBe('development')
})

test('WORKER_ENABLED (padrão ligado) e EXPO_ACCESS_TOKEN (opcional)', () => {
  expect(parseEnv(ok).WORKER_ENABLED).toBe(true)
  expect(parseEnv({ ...ok, WORKER_ENABLED: 'false' }).WORKER_ENABLED).toBe(false)
  expect(parseEnv({ ...ok, WORKER_ENABLED: 'true' }).WORKER_ENABLED).toBe(true)
  expect(() => parseEnv({ ...ok, WORKER_ENABLED: 'talvez' })).toThrow(/WORKER_ENABLED/)
  expect(parseEnv(ok).EXPO_ACCESS_TOKEN).toBeUndefined()
  expect(parseEnv({ ...ok, EXPO_ACCESS_TOKEN: 'abc' }).EXPO_ACCESS_TOKEN).toBe('abc')
})

describe('hosts em produção', () => {
  const prod = { ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }
  const mensagem = (source: Record<string, string | undefined>): string => {
    try {
      parseEnv(source)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    return ''
  }

  test('aceita três hosts públicos distintos', () => {
    expect(parseEnv(prod).PAINEL_HOST).toBe('painel.exemplo.com')
    expect(parseEnv({ ...prod, DEV_HOST: 'dev.exemplo.com:8443' }).DEV_HOST).toBe('dev.exemplo.com:8443')
  })

  test.each(['DEV_HOST', 'PAINEL_HOST', 'API_HOST'])('%s ausente ou vazio é recusado e nomeia a variável', (nome) => {
    expect(mensagem({ ...prod, [nome]: undefined })).toMatch(new RegExp(nome))
    expect(mensagem({ ...prod, [nome]: '' })).toMatch(new RegExp(nome))
  })

  test.each(['localhost', 'localhost:3000', 'dev.localhost:3000', 'API.LOCALHOST', '127.0.0.1:3000', '[::1]:3000'])(
    'host local %s é recusado',
    (valor) => {
      expect(mensagem({ ...prod, API_HOST: valor })).toMatch(/API_HOST/)
    },
  )

  test('hosts repetidos são recusados, mesmo com maiúsculas, espaço ou ponto final', () => {
    expect(mensagem({ ...prod, PAINEL_HOST: 'dev.exemplo.com' })).toMatch(/PAINEL_HOST/)
    expect(mensagem({ ...prod, API_HOST: ' DEV.exemplo.com. ' })).toMatch(/API_HOST/)
  })

  test('host com protocolo ou barra é recusado', () => {
    expect(mensagem({ ...prod, DEV_HOST: 'https://dev.exemplo.com' })).toMatch(/DEV_HOST/)
    expect(mensagem({ ...prod, DEV_HOST: 'dev.exemplo.com/' })).toMatch(/DEV_HOST/)
  })

  test('a mensagem não traz o valor dos hosts', () => {
    expect(mensagem({ ...prod, API_HOST: 'api.localhost:3000' })).not.toContain('api.localhost:3000')
  })

  test('build e ambientes que não são produção dispensam as regras', () => {
    expect(parseEnv({ ...ok, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40), NEXT_PHASE: 'phase-production-build' }).NODE_ENV).toBe('production')
    expect(parseEnv({ ...ok, NODE_ENV: 'development' }).DEV_HOST).toBe('dev.localhost:3000')
    expect(parseEnv({ ...ok, NODE_ENV: 'test' }).DEV_HOST).toBe('dev.localhost:3000')
  })
})

describe('avisos de produção', () => {
  const prod = parseEnv({ ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40), TRUSTED_PROXY_HOPS: '1', SMTP_URL: 'smtp://u:senha-secreta@h:587', MAIL_FROM: 'A <a@exemplo.com>', NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'chave-de-teste', APP_WEB_ORIGINS: 'https://app.exemplo.com' })

  test('configuração completa não gera aviso', () => {
    expect(productionWarnings(prod)).toEqual([])
  })

  test('sem proxy confiável avisa que o IP não é conhecido', () => {
    const avisos = productionWarnings({ ...prod, TRUSTED_PROXY_HOPS: 0 })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/TRUSTED_PROXY_HOPS/)
    expect(avisos[0]).toMatch(/limites por IP desligados e auditoria sem IP/)
  })

  test('sem SMTP_URL avisa que e-mails não saem e não vaza a URL quando existe', () => {
    const avisos = productionWarnings({ ...prod, SMTP_URL: undefined })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/SMTP_URL/)
    expect(avisos[0]).toMatch(/convites e cadastro pelo app não chegam/)
    expect(productionWarnings({ ...prod, TRUSTED_PROXY_HOPS: 0 }).join(' ')).not.toContain('senha-secreta')
  })

  test('sem NEXT_SERVER_ACTIONS_ENCRYPTION_KEY avisa que várias instâncias exigem a chave fixa', () => {
    const avisos = productionWarnings({ ...prod, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: undefined })
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/)
    expect(avisos[0]).toMatch(/várias instâncias/)
  })

  test('não vaza o valor da chave', () => {
    expect(productionWarnings({ ...prod, TRUSTED_PROXY_HOPS: 0 }).join(' ')).not.toContain('chave-de-teste')
  })

  test('sem APP_WEB_ORIGINS avisa que o app web não chama a API (os apps nativos seguem)', () => {
    for (const vazia of [undefined, '', ' , ']) {
      const avisos = productionWarnings({ ...prod, APP_WEB_ORIGINS: vazia })
      expect(avisos, String(vazia)).toHaveLength(1)
      expect(avisos[0]).toMatch(/APP_WEB_ORIGINS vazio/)
    }
  })

  test('fora de produção não avisa', () => {
    expect(productionWarnings({ ...prod, NODE_ENV: 'development', TRUSTED_PROXY_HOPS: 0 })).toEqual([])
  })
})

describe('APP_WEB_ORIGINS', () => {
  const prod = { ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }
  const mensagem = (source: Record<string, string | undefined>): string => {
    try {
      parseEnv(source)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    return ''
  }

  test('é opcional; sem ela o valor é indefinido', () => {
    expect(parseEnv(ok).APP_WEB_ORIGINS).toBeUndefined()
    expect(parseEnv(prod).APP_WEB_ORIGINS).toBeUndefined()
  })

  test('em produção aceita uma ou várias origens https', () => {
    expect(parseEnv({ ...prod, APP_WEB_ORIGINS: 'https://app.exemplo.com' }).APP_WEB_ORIGINS).toBe('https://app.exemplo.com')
    expect(parseEnv({ ...prod, APP_WEB_ORIGINS: 'https://app.exemplo.com, https://b.exemplo.com:8443/' }).NODE_ENV).toBe('production')
  })

  test.each(['app.exemplo.com', 'https://app.exemplo.com/caminho', 'ftp://app.exemplo.com', 'https://usuario@app.exemplo.com', '*', 'https://a b.com'])(
    'origem malformada (%s) falha em qualquer ambiente, nomeia a variável e não imprime o valor',
    (valor) => {
      for (const base of [ok, { ...ok, NODE_ENV: 'development' }, prod]) {
        const msg = mensagem({ ...base, APP_WEB_ORIGINS: `https://certa.exemplo.com,${valor}` })
        expect(msg).toMatch(/APP_WEB_ORIGINS/)
        expect(msg).toMatch(/nº 2/)
        expect(msg).not.toContain(valor)
      }
    },
  )

  test.each(['http://app.exemplo.com', 'http://localhost:5173', 'https://localhost:5173', 'https://app.localhost', 'https://127.0.0.1:3000', 'https://[::1]:3000'])(
    'em produção a origem %s (http ou local) falha sem imprimir o valor',
    (valor) => {
      const msg = mensagem({ ...prod, APP_WEB_ORIGINS: valor })
      expect(msg).toMatch(/APP_WEB_ORIGINS/)
      expect(msg).toMatch(/https/)
      expect(msg).not.toContain(valor)
    },
  )

  test('fora de produção e na fase de build, http e localhost passam', () => {
    expect(parseEnv({ ...ok, NODE_ENV: 'development', APP_WEB_ORIGINS: 'http://localhost:5173' }).APP_WEB_ORIGINS).toBe('http://localhost:5173')
    expect(parseEnv({ ...ok, NODE_ENV: 'test', APP_WEB_ORIGINS: 'http://app.localhost:3000' }).NODE_ENV).toBe('test')
    expect(parseEnv({ ...prod, APP_WEB_ORIGINS: 'http://localhost:5173', NEXT_PHASE: 'phase-production-build' }).NODE_ENV).toBe('production')
  })
})

describe('URL do banco', () => {
  const direta = 'postgres://u:p@direto:5432/d'
  const pooler = 'postgres://u:p@pooler:6432/d'
  const base = { DATABASE_URL: pooler, APP_SECRET: 'x'.repeat(32) }

  test('sem DIRECT_URL, tudo usa DATABASE_URL', () => {
    const e = parseEnv(base)
    expect(runtimeDatabaseUrl(e)).toBe(pooler)
    expect(migrationDatabaseUrl(e)).toBe(pooler)
  })

  test('com DIRECT_URL, as migrações usam a direta e o servidor continua na DATABASE_URL', () => {
    const e = parseEnv({ ...base, DIRECT_URL: direta })
    expect(runtimeDatabaseUrl(e)).toBe(pooler)
    expect(migrationDatabaseUrl(e)).toBe(direta)
  })

  test('DATABASE_USE_DIRECT_URL=true leva o servidor para a direta também', () => {
    const e = parseEnv({ ...base, DIRECT_URL: direta, DATABASE_USE_DIRECT_URL: 'true' })
    expect(runtimeDatabaseUrl(e)).toBe(direta)
    expect(migrationDatabaseUrl(e)).toBe(direta)
    expect(parseEnv({ ...base, DIRECT_URL: direta, DATABASE_USE_DIRECT_URL: 'false' }).DATABASE_USE_DIRECT_URL).toBe(false)
  })

  test('DATABASE_USE_DIRECT_URL=true sem DIRECT_URL é recusado sem imprimir a URL', () => {
    let msg = ''
    try {
      parseEnv({ ...base, DATABASE_USE_DIRECT_URL: 'true' })
    } catch (e) {
      msg = String(e)
    }
    expect(msg).toMatch(/DIRECT_URL/)
    expect(msg).not.toContain('pooler')
  })

  test('DIRECT_URL vazia conta como ausente e valor inválido de DATABASE_USE_DIRECT_URL é recusado', () => {
    expect(migrationDatabaseUrl(parseEnv({ ...base, DIRECT_URL: undefined }))).toBe(pooler)
    expect(() => parseEnv({ ...base, DATABASE_USE_DIRECT_URL: 'sim' })).toThrow(/DATABASE_USE_DIRECT_URL/)
  })
})

describe('INTEGRATIONS_MODE', () => {
  const prod = { ...ok, ...hostsDeProducao, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }

  test('em produção `fake` é erro de partida (e o valor não vai para a mensagem de outras variáveis)', () => {
    expect(() => parseEnv({ ...prod, INTEGRATIONS_MODE: 'fake' })).toThrow(/INTEGRATIONS_MODE/)
  })

  test('sem a variável: produção resolve `real`; desenvolvimento e teste resolvem `fake`', () => {
    expect(parseEnv(prod).INTEGRATIONS_MODE).toBe('real')
    expect(parseEnv({ ...ok, NODE_ENV: 'development' }).INTEGRATIONS_MODE).toBe('fake')
    expect(parseEnv({ ...ok, NODE_ENV: 'test' }).INTEGRATIONS_MODE).toBe('fake')
    expect(parseEnv(ok).INTEGRATIONS_MODE).toBe('fake')
  })

  test('valores aceitos: `real` em qualquer ambiente, `fake` fora de produção; o resto é erro', () => {
    expect(parseEnv({ ...prod, INTEGRATIONS_MODE: 'real' }).INTEGRATIONS_MODE).toBe('real')
    expect(parseEnv({ ...ok, INTEGRATIONS_MODE: 'real' }).INTEGRATIONS_MODE).toBe('real')
    expect(parseEnv({ ...ok, INTEGRATIONS_MODE: 'fake' }).INTEGRATIONS_MODE).toBe('fake')
    expect(() => parseEnv({ ...ok, INTEGRATIONS_MODE: 'misto' })).toThrow(/INTEGRATIONS_MODE/)
  })

  test('na fase de build do Next, produção com `fake` ainda carrega (só a execução recusa)', () => {
    expect(parseEnv({ ...prod, INTEGRATIONS_MODE: 'fake', NEXT_PHASE: 'phase-production-build' }).INTEGRATIONS_MODE).toBe('fake')
  })
})
