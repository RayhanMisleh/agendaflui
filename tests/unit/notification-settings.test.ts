import { NotificationKind } from '@/server/db/generated/enums'
import { DEFAULT_NOTIFICATION_SETTINGS, resolveNotificationSettings } from '@/server/domain/settings/notification-settings'

describe('resolveNotificationSettings', () => {
  test('os padrões ligam todos os tipos nos dois canais', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS).sort()).toEqual(Object.values(NotificationKind).sort())
    for (const toggle of Object.values(DEFAULT_NOTIFICATION_SETTINGS)) expect(toggle).toEqual({ email: true, push: true })
  })

  test('vazio devolve os padrões', () => {
    expect(resolveNotificationSettings({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  test('desliga só o e-mail do tipo informado', () => {
    const r = resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false } })
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: false, push: true })
    expect(r.APPOINTMENT_CANCELED).toEqual({ email: true, push: true })
  })

  test.each([null, 'x', 42, [], { FOO: { email: false } }, { APPOINTMENT_CONFIRMED: { email: 'não' } }, { APPOINTMENT_CONFIRMED: 'x' }])(
    'lixo é ignorado: %j',
    (raw) => {
      expect(resolveNotificationSettings(raw)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    },
  )

  test('um valor ruim não derruba os valores bons ao lado', () => {
    const r = resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: 'não', push: false }, FOO: 1 })
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: true, push: false })
  })

  test('não altera os padrões', () => {
    resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false } })
    expect(DEFAULT_NOTIFICATION_SETTINGS.APPOINTMENT_CONFIRMED.email).toBe(true)
  })
})
