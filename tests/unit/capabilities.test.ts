import type { Actor } from '@/server/auth/actor'
import { CAPABILITIES, can } from '@/server/auth/capabilities'
import type { MembershipRole } from '@/server/db/generated/client'

const member = (role: MembershipRole): Actor => ({ kind: 'member', userId: 'u', membershipId: 'm', name: 'n', role })

test('profissional só tem o básico', () => {
  const allowed = CAPABILITIES.filter((c) => can(member('PROFESSIONAL'), c))
  expect(allowed).toEqual(['view_dashboard', 'view_own_agenda', 'manage_own_availability', 'view_clients', 'view_own_reports'])
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
