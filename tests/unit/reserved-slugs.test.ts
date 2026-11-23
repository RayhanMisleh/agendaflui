import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { slugSchema } from '@/server/domain/platform/businesses'
import { RESERVED_SLUGS, isReservedSlug } from '@/shared/reserved-slugs'

const DA_SPEC = [
  'entrar', 'sair', 'conta', 'convite', 'cadastro', 'esqueci-a-senha', 'redefinir-senha', 'definir-senha', 'google', 'painel', 'webhooks',
  'arquivos', 'brand', 'healthz', 'api', 'dev', 'admin', 'www', 'suporte', 'app', 'ajuda', 'termos', 'privacidade',
]

test('a lista é a da spec, na ordem dela', () => {
  expect([...RESERVED_SLUGS]).toEqual(DA_SPEC)
})

test('sem repetidos e todos no formato de slug', () => {
  expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length)
  for (const s of RESERVED_SLUGS) {
    expect(s.length, s).toBeGreaterThanOrEqual(3)
    expect(s.length, s).toBeLessThanOrEqual(40)
    expect(s, s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  }
})

test('slugSchema recusa nome reservado e aceita os outros', () => {
  const r = slugSchema.safeParse('painel')
  expect(r.success).toBe(false)
  expect(JSON.stringify(r.error?.issues)).toContain('reservado pelo sistema')
  expect(slugSchema.safeParse('minha-loja').success).toBe(true)
  expect(isReservedSlug('google')).toBe(true)
  expect(isReservedSlug('demo')).toBe(false)
})
