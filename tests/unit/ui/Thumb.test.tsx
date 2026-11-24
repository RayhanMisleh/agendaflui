// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Thumb } from '@/ui/components'

test('com imagem mostra a miniatura sem texto alternativo (o nome fica ao lado)', () => {
  const { container } = render(<Thumb src="/a.png" />)
  const img = container.querySelector('img')
  expect(img).toHaveAttribute('src', '/a.png')
  expect(img).toHaveAttribute('alt', '')
})

test('sem imagem mostra um ícone e nenhum texto na caixa; o leitor de tela ouve "Sem imagem"', () => {
  const { container } = render(<Thumb src={null} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(screen.getByText('Sem imagem')).toHaveClass('af-sr')
})
