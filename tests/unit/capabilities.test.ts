import type { Actor } from '@/server/auth/actor'
import { CAPABILITIES, can } from '@/server/auth/capabilities'
import type { MembershipRole } from '@/server/db/generated/client'

const member = (role: MembershipRole): Actor => ({ kind: 'member', userId: 'u', membershipId: 'm', name: 'n', role })

test('profissional só tem o básico', () => {
  const allowed = CAPABILITIES.filter((c) => can(member('PROFESSIONAL'), c))
  expect(allowed).toEqual(['view_dashboard', 'view_own_agenda', 'manage_own_availability', 'view_clients', 'view_own_reports'])
})
const MODULOS = ['manage_loyalty', 'manage_banners', 'manage_store'] as const

test('as capacidades dos módulos entram no fim da lista e as cinco básicas seguem as cinco primeiras', () => {
  expect(CAPABILITIES.slice(0, 5)).toEqual(['view_dashboard', 'view_own_agenda', 'manage_own_availability', 'view_clients', 'view_own_reports'])
  expect(CAPABILITIES.slice(-3)).toEqual([...MODULOS])
})
test('gerente, dono e suporte gerenciam os módulos; profissional e admin da plataforma não', () => {
  for (const c of MODULOS) {
    expect(can(member('MANAGER'), c)).toBe(true)
    expect(can(member('OWNER'), c)).toBe(true)
    expect(can({ kind: 'impersonator', adminId: 'a', name: 'n' }, c)).toBe(true)
    expect(can(member('PROFESSIONAL'), c)).toBe(false)
    expect(can({ kind: 'platform_admin', adminId: 'a', name: 'n' }, c)).toBe(false)
  }
  expect(can(member('MANAGER'), 'manage_store')).toBe(true)
  expect(can(member('PROFESSIONAL'), 'manage_loyalty')).toBe(false)
})
test('gerente tem tudo menos a conta', () => {
  expect(CAPABILITIES.filter((c) => !can(member('MANAGER'), c))).toEqual(['manage_account'])
})
test('dono e suporte têm tudo', () => {
  expect(CAPABILITIES.every((c) => can(member('OWNER'), c))).toBe(true)
  expect(CAPABILITIES.every((c) => can({ kind: 'impersonator', adminId: 'a', name: 'n' }, c))).toBe(true)
})
test('admin da plataforma só tem a capacidade de ajustar as configurações da conta (marca, regras e avisos)', () => {
  expect(CAPABILITIES.filter((c) => can({ kind: 'platform_admin', adminId: 'a', name: 'n' }, c))).toEqual(['manage_settings'])
})
test('sistema não tem capacidade de conta', () => {
  expect(CAPABILITIES.some((c) => can({ kind: 'system' }, c))).toBe(false)
})
