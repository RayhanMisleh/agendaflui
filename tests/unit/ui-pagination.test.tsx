// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Pagination, pageHref } from '@/ui/components/Pagination'

test('pageHref junta busca, filtro e cursor e descarta o que está vazio', () => {
  expect(pageHref('/contas', { search: 'pata viva', status: 'ACTIVE' }, 'abc_-9')).toBe('/contas?search=pata+viva&status=ACTIVE&cursor=abc_-9')
  expect(pageHref('/contas', { search: '', status: undefined }, null)).toBe('/contas')
})

test('a próxima página leva o cursor e preserva busca e filtro', () => {
  render(<Pagination basePath="/contas" params={{ search: 'pata', status: 'SUSPENDED' }} cursor="atual" nextCursor="proximo" />)
  expect(screen.getByRole('link', { name: 'Próxima página' })).toHaveAttribute('href', '/contas?search=pata&status=SUSPENDED&cursor=proximo')
  expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/contas?search=pata&status=SUSPENDED')
})

test('na primeira página não há "Voltar ao início"; na última não há "Próxima página"', () => {
  const { rerender } = render(<Pagination basePath="/contas" params={{}} cursor={null} nextCursor="x" />)
  expect(screen.queryByRole('link', { name: 'Voltar ao início' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Próxima página' })).toBeInTheDocument()
  rerender(<Pagination basePath="/contas" params={{}} cursor="y" nextCursor={null} />)
  expect(screen.queryByRole('link', { name: 'Próxima página' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/contas')
})

test('sem outra página não desenha nada', () => {
  const { container } = render(<Pagination basePath="/contas" params={{}} cursor={null} nextCursor={null} />)
  expect(container).toBeEmptyDOMElement()
})

test('a navegação tem nome acessível', () => {
  render(<Pagination basePath="/contas" params={{}} cursor={null} nextCursor="x" />)
  expect(screen.getByRole('navigation', { name: 'Páginas da lista' })).toBeInTheDocument()
})
