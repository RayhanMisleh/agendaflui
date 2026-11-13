// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataList, EmptyState } from '@/ui/components'

const columns = [{ key: 'n', header: 'Nome', cell: (r: { n: string }) => r.n, primary: true }]

test('lista vazia mostra o convite', () => {
  render(<DataList columns={columns} rows={[]} rowKey={(r) => r.n} empty={<EmptyState title="Nenhum cliente ainda" />} />)
  expect(screen.getByText('Nenhum cliente ainda')).toBeInTheDocument()
})

test('linha clicável responde ao Enter', async () => {
  const onRowClick = vi.fn()
  render(
    <DataList columns={columns} rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty={null} />,
  )
  screen.getAllByText('Ana')[0]!.closest<HTMLElement>('[tabindex]')!.focus()
  await userEvent.keyboard('{Enter}')
  expect(onRowClick).toHaveBeenCalledWith({ n: 'Ana' })
})

test('linha clicável responde ao Espaço e ao clique', async () => {
  const onRowClick = vi.fn()
  render(
    <DataList columns={columns} rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty={null} />,
  )
  screen.getAllByText('Ana')[0]!.closest<HTMLElement>('[tabindex]')!.focus()
  await userEvent.keyboard(' ')
  expect(onRowClick).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getAllByText('Ana')[0]!)
  expect(onRowClick).toHaveBeenCalledTimes(2)
})

test('sem onRowClick as linhas não são focáveis', () => {
  render(<DataList columns={columns} rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} empty={null} />)
  expect(screen.getAllByText('Ana')[0]!.closest('[tabindex]')).toBeNull()
})
