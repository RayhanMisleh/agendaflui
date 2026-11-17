// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { ThemeScope } from '@/ui/theme/ThemeScope'
import { deriveTheme } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

test('aplica as variáveis da marca, o esquema e a fonte no div', () => {
  const theme = deriveTheme({ ...AGENDAFLUI_BRAND, material: 'WOOD', fontPair: 'MODERN' })
  const { container } = render(
    <ThemeScope theme={theme} className="x">
      <span>oi</span>
    </ThemeScope>,
  )
  const div = container.firstElementChild as HTMLElement
  expect(div.getAttribute('data-theme')).toBe('')
  expect(div.getAttribute('data-scheme')).toBe('day')
  expect(div.hasAttribute('data-material')).toBe(false)
  expect(div.getAttribute('data-font')).toBe('modern')
  expect(div.className).toBe('x')
  expect(div.style.getPropertyValue('--brand').toUpperCase()).toBe(theme.vars['--brand'])
  expect(div.style.getPropertyValue('--side-bg').toUpperCase()).toBe(theme.vars['--side-bg'])
  expect(div.textContent).toBe('oi')
})

test('o tema noite marca data-scheme="night"', () => {
  const theme = deriveTheme({ ...AGENDAFLUI_BRAND, scheme: 'night' })
  const { container } = render(<ThemeScope theme={theme}>x</ThemeScope>)
  expect((container.firstElementChild as HTMLElement).getAttribute('data-scheme')).toBe('night')
})
