// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

test('nowrap e align end marcam cabeçalho e célula da tabela', () => {
  const cols = [
    { key: 'n', header: 'Nome', cell: (r: { n: string; t: string }) => r.n, primary: true },
    { key: 't', header: 'Telefone', cell: (r: { n: string; t: string }) => r.t, nowrap: true, align: 'end' as const },
  ]
  render(<DataList columns={cols} rows={[{ n: 'Ana', t: '(11) 98421-7733' }]} rowKey={(r) => r.n} empty={null} />)
  const th = screen.getByRole('columnheader', { name: 'Telefone' })
  const td = screen.getAllByText('(11) 98421-7733')[0]!.closest('td')!
  for (const el of [th, td]) {
    expect(el).toHaveClass('af-col--nowrap')
    expect(el).toHaveClass('af-col--end')
  }
  expect(screen.getByRole('columnheader', { name: 'Nome' })).not.toHaveClass('af-col--nowrap')
})

test('a troca tabela e cartões depende do contêiner, não da tela', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/data.css'), 'utf8')
  expect(css).toMatch(/container:\s*af-datalist \/ inline-size/)
  expect(css).toMatch(/@container af-datalist \(min-width: 36rem\)/)
  expect(css).not.toMatch(/@media \(min-width: 768px\)/)
})
