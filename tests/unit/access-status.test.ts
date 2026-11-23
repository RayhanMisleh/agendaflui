import { describe, expect, test } from 'vitest'
import { ACCESS_STATUS_LABEL, accessStatus } from '@/server/domain/team/access-status'

describe('accessStatus', () => {
  test.each([
    [{ active: false, hasPassword: true, inviteMailFailed: false }, 'inactive'],
    [{ active: false, hasPassword: false, inviteMailFailed: true }, 'inactive'],
    [{ active: true, hasPassword: true, inviteMailFailed: true }, 'active'],
    [{ active: true, hasPassword: true, inviteMailFailed: false }, 'active'],
    [{ active: true, hasPassword: false, inviteMailFailed: true }, 'invite_failed'],
    [{ active: true, hasPassword: false, inviteMailFailed: false }, 'invited'],
    [null, 'none'],
  ] as const)('%o → %s', (m, s) => {
    expect(accessStatus(m)).toBe(s)
  })

  test('os rótulos são os da tela', () => {
    expect(ACCESS_STATUS_LABEL).toEqual({
      invited: 'Convite enviado',
      invite_failed: 'Convite não enviado',
      active: 'Ativo',
      inactive: 'Desativado',
      none: 'Sem acesso',
    })
  })
})
