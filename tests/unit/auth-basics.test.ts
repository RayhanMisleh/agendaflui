import { hashPassword, passwordSchema, verifyPassword } from '@/server/auth/password'
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
