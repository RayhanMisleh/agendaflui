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

test('cada célula é desenhada uma vez só, com o cabeçalho como rótulo dentro dela', () => {
  const cell = vi.fn((r: { n: string; t: string }) => r.t)
  const cols = [
    { key: 'n', header: 'Nome', cell: (r: { n: string; t: string }) => r.n, primary: true },
    { key: 't', header: 'Telefone', cell: cell },
  ]
  const { container } = render(<DataList columns={cols} rows={[{ n: 'Ana', t: '(11) 98421-7733' }, { n: 'Bia', t: '(11) 90000-0000' }]} rowKey={(r) => r.n} empty={null} />)
  expect(cell).toHaveBeenCalledTimes(2)
  expect(screen.getAllByText('(11) 98421-7733')).toHaveLength(1)
  expect(screen.getAllByText('Ana')).toHaveLength(1)
  expect(container.querySelectorAll('.af-datalist__item, ul.af-datalist__cards, dl')).toHaveLength(0)
  const celulaTelefone = screen.getByText('(11) 98421-7733').closest('td')!
  expect(celulaTelefone.querySelector('.af-datalist__label')).toHaveTextContent('Telefone')
})

test('a coluna principal vira o título do cartão', () => {
  const cols = [
    { key: 't', header: 'Telefone', cell: (r: { n: string; t: string }) => r.t },
    { key: 'n', header: 'Nome', cell: (r: { n: string; t: string }) => r.n, primary: true },
  ]
  render(<DataList columns={cols} rows={[{ n: 'Ana', t: '1' }]} rowKey={(r) => r.n} empty={null} />)
  expect(screen.getByText('Ana').closest('td')).toHaveAttribute('data-primary')
  expect(screen.getByText('1').closest('td')).not.toHaveAttribute('data-primary')
})

test('o limite entre tabela e cartões é de cada lista: stack escolhe o tamanho', () => {
  const rows = [{ n: 'Ana' }]
  const { container, rerender } = render(<DataList columns={columns} rows={rows} rowKey={(r) => r.n} empty={null} />)
  expect(container.querySelector('.af-datalist')).toHaveAttribute('data-stack', 'md')
  rerender(<DataList columns={columns} rows={rows} rowKey={(r) => r.n} empty={null} stack="lg" />)
  expect(container.querySelector('.af-datalist')).toHaveAttribute('data-stack', 'lg')
  rerender(<DataList columns={columns} rows={rows} rowKey={(r) => r.n} empty={null} stack="sm" />)
  expect(container.querySelector('.af-datalist')).toHaveAttribute('data-stack', 'sm')
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/data.css'), 'utf8')
  expect(css).toMatch(/@container af-datalist \(min-width: 28rem\)/)
  expect(css).toMatch(/@container af-datalist \(min-width: 48rem\)/)
})

test('a tabela mantém a semântica de tabela mesmo quando o CSS a desenha como cartões', () => {
  render(<DataList columns={columns} rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} empty={null} label="Clientes" />)
  expect(screen.getByRole('table', { name: 'Clientes' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument()
  expect(screen.getAllByRole('row')).toHaveLength(2)
  expect(screen.getByRole('cell', { name: /Ana/ })).toBeInTheDocument()
})

test('telefone e botão de outra célula não disparam a linha clicável', async () => {
  const onRowClick = vi.fn()
  const cols = [
    { key: 'n', header: 'Nome', cell: (r: { n: string }) => r.n, primary: true },
    { key: 't', header: 'Telefone', cell: () => <a href="tel:+5511984217733">Ligar</a> },
    { key: 'b', header: 'Ação', cell: () => <button type="button">Abrir</button> },
  ]
  render(<DataList columns={cols} rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty={null} />)
  const ligar = screen.getByRole('link', { name: 'Ligar' })
  ligar.addEventListener('click', (e) => e.preventDefault())
  await userEvent.click(ligar)
  await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
  expect(onRowClick).not.toHaveBeenCalled()
  expect(ligar.closest('.af-row-hit')).toBeNull()
})

describe('CSS da lista', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/data.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  test('em cartão, os controles das outras células ficam acima da área de toque da linha (em cartão e em tabela)', () => {
    const regra = /\.af-datalist__value :is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css)
    expect(regra).not.toBeNull()
    for (const alvo of ['a[href]', 'button', 'input', 'select', 'textarea', "[role='button']"]) expect(regra?.[1]).toContain(alvo)
    expect(regra?.[2]).toMatch(/position:\s*relative/)
    expect(regra?.[2]).toMatch(/z-index:\s*1\b/)
    expect(css).toMatch(/\.af-row-hit::after\s*\{[^}]*position:\s*absolute/)
  })

  test('as regras de tabela e de cartão existem uma vez só: cada consulta de contêiner só troca as variáveis --dl-*', () => {
    expect(css).not.toMatch(/\.af-datalist\[data-stack='\w+'\] \.af-datalist__(label|table (thead|tbody|tr|td|th))/)
    expect(css).not.toMatch(/\.af-row-hit::after\s*\{[^}]*content:\s*none/)
    const consultas = [...css.matchAll(/@container af-datalist \(min-width: (\d+)rem\)\s*\{([\s\S]*?)\n  \}/g)]
    expect(consultas.map((c) => c[1])).toEqual(['28', '36', '48'])
    for (const c of consultas) {
      const declaracoes = [...(c[2] ?? '').matchAll(/(--[\w-]+):/g)].map((m) => m[1])
      expect(declaracoes.length).toBeGreaterThan(5)
      for (const d of declaracoes) expect(d).toMatch(/^--(dl-|cell-)/)
    }
  })
})
