import { ROTULOS_AVISO, tiposDeAviso } from '@/app/dev/(app)/contas/[id]/avisos'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/server/domain/settings/notification-settings'

test('todo tipo de aviso do domínio tem rótulo na tela, e a tela não tem rótulo de tipo que não existe', () => {
  const tipos = Object.keys(DEFAULT_NOTIFICATION_SETTINGS).sort()
  expect(Object.keys(ROTULOS_AVISO).sort()).toEqual(tipos)
})

test('a matriz usa os tipos do domínio, na ordem do domínio, com o rótulo da tela', () => {
  const lista = tiposDeAviso()
  expect(lista.map((a) => a.kind)).toEqual(Object.keys(DEFAULT_NOTIFICATION_SETTINGS))
  for (const a of lista) expect(a.label).toBe(ROTULOS_AVISO[a.kind])
})
