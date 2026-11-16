import { parseEnv } from '@/server/env'

const ok = { DATABASE_URL: 'postgres://u:p@localhost:5432/d', APP_SECRET: 'x'.repeat(32) }

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
  expect(parseEnv({ ...ok, NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }).NODE_ENV).toBe('production')
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
