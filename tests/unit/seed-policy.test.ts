import { planSeed } from '../../scripts/seed-policy'

const COMPLETO = {
  SEED_ADMIN_EMAIL: 'admin@exemplo.test',
  SEED_ADMIN_PASSWORD: 'senha-bem-longa',
  SEED_USER_PASSWORD: 'senha-bem-longa',
}

test('com todas as variáveis, roda o seed (banco vazio ou não)', () => {
  expect(planSeed(COMPLETO, 0)).toEqual({ run: true })
  expect(planSeed(COMPLETO, 2)).toEqual({ run: true })
})

test('sem variáveis e com contas no banco, pula o seed sem falhar', () => {
  expect(planSeed({}, 2)).toEqual({ run: false })
  expect(planSeed({ ...COMPLETO, SEED_USER_PASSWORD: undefined }, 1)).toEqual({ run: false })
  expect(planSeed({ ...COMPLETO, SEED_ADMIN_EMAIL: '' }, 1)).toEqual({ run: false })
})

test('sem variáveis e com o banco vazio, o erro é uma frase que diz o que fazer', () => {
  const plano = planSeed({ ...COMPLETO, SEED_USER_PASSWORD: undefined, SEED_ADMIN_PASSWORD: '' }, 0)
  expect(plano.run).toBe(false)
  if (!('error' in plano)) throw new Error('Era esperado um erro.')
  expect(plano.error).toContain('SEED_USER_PASSWORD')
  expect(plano.error).toContain('SEED_ADMIN_PASSWORD')
  expect(plano.error).not.toContain('SEED_ADMIN_EMAIL')
  expect(plano.error).toContain('.env.example')
  expect(plano.error).not.toContain('\n')
})
