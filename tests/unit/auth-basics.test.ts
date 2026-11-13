import { hashPassword, passwordSchema, verifyPassword } from '@/server/auth/password'
import { createRateLimiter } from '@/server/auth/rate-limit'
import { generateToken, hashToken } from '@/server/auth/tokens'

test('senha: hash argon2id confere só com a senha certa', async () => {
  const h = await hashPassword('senha-bem-longa')
  expect(h.startsWith('$argon2id$')).toBe(true)
  expect(await verifyPassword(h, 'senha-bem-longa')).toBe(true)
  expect(await verifyPassword(h, 'outra-senha-longa')).toBe(false)
})
test('senha: tamanho de 10 a 200', () => {
  expect(passwordSchema.safeParse('123456789').success).toBe(false)
  expect(passwordSchema.safeParse('1234567890').success).toBe(true)
  expect(passwordSchema.safeParse('a'.repeat(201)).success).toBe(false)
})
test('token: hash confere e tokens são únicos', () => {
  const a = generateToken()
  const b = generateToken()
  expect(a.hash).toBe(hashToken(a.token))
  expect(a.token).not.toBe(b.token)
})
test('limitador barra a 3ª chamada e libera depois da janela', () => {
  let t = 0
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t })
  expect(rl.check('k').allowed).toBe(true)
  expect(rl.check('k').allowed).toBe(true)
  const third = rl.check('k')
  expect(third.allowed).toBe(false)
  expect(third.retryAfterMs).toBeGreaterThan(0)
  expect(rl.check('outra').allowed).toBe(true)
  t = 1000
  expect(rl.check('k').allowed).toBe(true)
})
test('limitador: reset zera a contagem', () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
  rl.check('k')
  expect(rl.check('k').allowed).toBe(false)
  rl.reset('k')
  expect(rl.check('k').allowed).toBe(true)
})

test('limitador: a chave some do mapa quando a janela passa, sem precisar de nova tentativa dela', () => {
  let t = 0
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t })
  rl.check('antiga')
  rl.check('antiga')
  expect(rl.size()).toBe(1)
  t = 500
  rl.check('recente')
  expect(rl.size()).toBe(2)
  t = 1001
  rl.check('outra')
  expect(rl.size()).toBe(2)
  t = 1600
  rl.check('outra')
  expect(rl.size()).toBe(1)
  expect(rl.check('antiga').allowed).toBe(true)
})
test('limitador: o mapa não passa do teto de chaves e descarta as mais antigas', () => {
  let t = 0
  const rl = createRateLimiter({ limit: 5, windowMs: 1_000_000, maxKeys: 10_000, now: () => t })
  for (let i = 0; i < 10_050; i++) {
    t = i
    rl.check(`chave-${i}`)
  }
  expect(rl.size()).toBe(10_000)
  const pequeno = createRateLimiter({ limit: 1, windowMs: 1_000_000, maxKeys: 2, now: () => t })
  pequeno.check('a')
  pequeno.check('b')
  pequeno.check('c')
  expect(pequeno.size()).toBe(2)
  expect(pequeno.check('a').allowed).toBe(true)
  expect(pequeno.check('c').allowed).toBe(false)
})
test('limitador: o teto padrão é 10.000 chaves', () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 1_000_000, now: () => 0 })
  for (let i = 0; i < 10_100; i++) rl.check(`k${i}`)
  expect(rl.size()).toBe(10_000)
})
