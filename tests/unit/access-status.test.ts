import { describe, expect, test } from 'vitest'
import { ACCESS_STATUS_LABEL, accessStatus } from '@/server/domain/team/access-status'

describe('accessStatus', () => {
  test.each([
    [{ active: false, hasAccount: true, inviteMailFailed: false }, 'inactive'],
    [{ active: false, hasAccount: false, inviteMailFailed: true }, 'inactive'],
    [{ active: true, hasAccount: true, inviteMailFailed: true }, 'active'],
    [{ active: true, hasAccount: true, inviteMailFailed: false }, 'active'],
    [{ active: true, hasAccount: false, inviteMailFailed: true }, 'invite_failed'],
    [{ active: true, hasAccount: false, inviteMailFailed: false }, 'invited'],
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
