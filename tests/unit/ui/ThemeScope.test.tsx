// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { ThemeScope } from '@/ui/theme/ThemeScope'
import { deriveTheme } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

test('aplica material, fonte e variáveis no div', () => {
  const theme = deriveTheme({ ...AGENDAFLUI_BRAND, material: 'WOOD', fontPair: 'MODERN' })
  const { container } = render(
    <ThemeScope theme={theme} className="x">
      <span>oi</span>
    </ThemeScope>,
  )
  const div = container.firstElementChild as HTMLElement
  expect(div.getAttribute('data-material')).toBe('wood')
  expect(div.getAttribute('data-font')).toBe('modern')
  expect(div.className).toBe('x')
  expect(div.style.getPropertyValue('--cover').toUpperCase()).toBe(theme.vars['--cover'])
  expect(div.textContent).toBe('oi')
})
