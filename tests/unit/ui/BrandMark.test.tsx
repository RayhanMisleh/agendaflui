// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { BrandMark } from '@/ui/shells'

test('a marca Agenda Flui desenha o símbolo e o nome em HTML, sem texto dentro do SVG', () => {
  const { container } = render(<BrandMark name="Agenda Flui" logoUrl={null} size="md" platform />)
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.querySelector('svg text')).toBeNull()
  const nome = screen.getByText('agenda', { exact: false })
  expect(nome.textContent).toBe('agenda flui')
  expect(nome.querySelector('.af-brand__flui')?.textContent).toBe('flui')
})

test('só símbolo: sem nome visível e com o nome acessível', () => {
  const { container } = render(<BrandMark name="Agenda Flui" logoUrl={null} size="sm" platform variant="symbol" />)
  expect(container.querySelector('.af-brand__wordmark')).toBeNull()
  expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Agenda Flui')
})

test('negativo usa o símbolo claro', () => {
  const { container } = render(<BrandMark name="Agenda Flui" logoUrl={null} size="md" platform variant="negative" />)
  expect(container.querySelector('.af-brand--negative')).not.toBeNull()
  expect(container.querySelector('svg rect')?.getAttribute('fill')).toBe('#3CC4B4')
})

test('o símbolo mantém as cores da marca, com o ponto caramelo', () => {
  const { container } = render(<BrandMark name="Agenda Flui" logoUrl={null} size="md" platform />)
  const fills = Array.from(container.querySelectorAll('svg rect, svg circle')).map((e) => e.getAttribute('fill'))
  expect(fills).toEqual(['#0B6E66', '#0F2A27', '#0F2A27', '#F2A93B'])
})

test('conta com logo própria continua usando a logo; sem logo, o nome', () => {
  const { container, rerender } = render(<BrandMark name="Patas & Cia" logoUrl="/arquivos/logo.png" size="lg" />)
  expect(screen.getByAltText('Patas & Cia')).toHaveAttribute('src', '/arquivos/logo.png')
  expect(container.querySelector('svg')).toBeNull()
  rerender(<BrandMark name="Patas & Cia" logoUrl={null} size="lg" />)
  expect(screen.getByText('Patas & Cia')).toBeInTheDocument()
  expect(container.querySelector('svg')).toBeNull()
})
