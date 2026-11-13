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
