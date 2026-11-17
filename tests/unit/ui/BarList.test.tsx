// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { BarList, DateRangeField } from '@/ui/components'

test('cada barra tem o valor escrito e a largura é proporcional ao maior', () => {
  const { container } = render(
    <BarList label="Receita por dia" items={[{ key: 'a', label: '15/11', value: 200, display: 'R$ 2,00' }, { key: 'b', label: '16/11', value: 100, display: 'R$ 1,00' }, { key: 'c', label: '17/11', value: 0, display: 'R$ 0,00' }]} />,
  )
  expect(screen.getByRole('list', { name: 'Receita por dia' })).toBeInTheDocument()
  expect(screen.getByText('R$ 2,00')).toBeInTheDocument()
  const larguras = [...container.querySelectorAll<HTMLElement>('.af-barlist__fill')].map((e) => e.style.width)
  expect(larguras).toEqual(['100%', '50%', '0%'])
})

test('lista só de zeros não desenha barra nem divide por zero', () => {
  const { container } = render(<BarList label="x" items={[{ key: 'a', label: 'a', value: 0, display: '0' }]} />)
  expect(container.querySelector<HTMLElement>('.af-barlist__fill')?.style.width).toBe('0%')
})

test('o intervalo livre são dois campos de data nomeados de e ate', () => {
  render(<DateRangeField from="2026-11-01" to="2026-11-17" />)
  expect(screen.getByLabelText('De')).toHaveAttribute('name', 'de')
  expect(screen.getByLabelText('Até')).toHaveValue('2026-11-17')
})
