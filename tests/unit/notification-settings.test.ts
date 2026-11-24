import { NotificationKind } from '@/server/db/generated/enums'
import { DEFAULT_NOTIFICATION_SETTINGS, resolveNotificationSettings } from '@/server/domain/settings/notification-settings'

describe('resolveNotificationSettings', () => {
  test('os padrões ligam o e-mail de todos os tipos', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS).sort()).toEqual(Object.values(NotificationKind).sort())
    for (const toggle of Object.values(DEFAULT_NOTIFICATION_SETTINGS)) expect(toggle).toEqual({ email: true })
  })

  test('vazio devolve os padrões', () => {
    expect(resolveNotificationSettings({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  test('desliga só o e-mail do tipo informado', () => {
    const r = resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false } })
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: false })
    expect(r.APPOINTMENT_CANCELED).toEqual({ email: true })
  })

  test.each([null, 'x', 42, [], { FOO: { email: false } }, { APPOINTMENT_CONFIRMED: { email: 'não' } }, { APPOINTMENT_CONFIRMED: 'x' }])(
    'lixo é ignorado: %j',
    (raw) => {
      expect(resolveNotificationSettings(raw)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    },
  )

  test('um valor ruim não derruba os valores bons ao lado', () => {
    const r = resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: 'não' }, FOO: 1 })
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: true })
  })

  test('um `push` guardado de antes é ignorado na leitura', () => {
    const r = resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false, push: true } })
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: false })
  })

  test('não altera os padrões', () => {
    resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false } })
    expect(DEFAULT_NOTIFICATION_SETTINGS.APPOINTMENT_CONFIRMED.email).toBe(true)
  })
})
