import { isLocalDatabaseUrl, smokeRefusal } from '../../scripts/smoke-guard'

test('só localhost, 127.0.0.1 e ::1 são bancos locais', () => {
  expect(isLocalDatabaseUrl('postgres://u:p@localhost:54329/db')).toBe(true)
  expect(isLocalDatabaseUrl('postgresql://u:p@127.0.0.1:5432/db')).toBe(true)
  expect(isLocalDatabaseUrl('postgres://u:p@[::1]:5432/db')).toBe(true)
  expect(isLocalDatabaseUrl('postgres://u:p@LOCALHOST/db')).toBe(true)
})

test('nome parecido, host remoto e texto que não é endereço não valem', () => {
  expect(isLocalDatabaseUrl('postgres://u:p@localhost.example.com/db')).toBe(false)
  expect(isLocalDatabaseUrl('postgres://u:p@meu-localhost/db')).toBe(false)
  expect(isLocalDatabaseUrl('postgres://u:p@db.interno.example:5432/db')).toBe(false)
  expect(isLocalDatabaseUrl('postgres://u:p@10.0.0.5/db')).toBe(false)
  expect(isLocalDatabaseUrl('isto não é um endereço')).toBe(false)
  expect(isLocalDatabaseUrl('')).toBe(false)
})

test('produção ou banco remoto: a fumaça recusa, com mensagem clara que não mostra o endereço', () => {
  const remoto = 'postgres://usuario:senha-secreta@db.producao.example:5432/agenda'
  const a = smokeRefusal({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost/db' })
  expect(a).toMatch(/produção/)
  const b = smokeRefusal({ NODE_ENV: 'development', DATABASE_URL: remoto })
  expect(b).toMatch(/banco local/)
  for (const m of [a, b]) {
    expect(m).not.toContain('senha-secreta')
    expect(m).not.toContain('db.producao')
  }
})

test('desenvolvimento com banco local, ou sem DATABASE_URL (o script sobe o próprio banco), segue', () => {
  expect(smokeRefusal({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@localhost:54329/db' })).toBeNull()
  expect(smokeRefusal({ DATABASE_URL: 'postgres://u:p@127.0.0.1/db' })).toBeNull()
  expect(smokeRefusal({})).toBeNull()
})
