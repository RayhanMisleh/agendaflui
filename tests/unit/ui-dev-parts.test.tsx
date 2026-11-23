// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyButton } from '@/ui/components/CopyButton'
import { FormErrors } from '@/ui/components/FormErrors'
import { SearchBar } from '@/ui/components/SearchBar'
import { StatusDot, businessStatusDot } from '@/ui/components/StatusDot'

test('StatusDot diz a situação em texto, não só em cor', () => {
  const { rerender } = render(<StatusDot {...businessStatusDot('ACTIVE')} />)
  expect(screen.getByText('Ativa')).toBeInTheDocument()
  rerender(<StatusDot {...businessStatusDot('SUSPENDED')} />)
  expect(screen.getByText('Suspensa')).toBeInTheDocument()
  rerender(<StatusDot {...businessStatusDot('ARCHIVED')} />)
  expect(screen.getByText('Arquivada')).toBeInTheDocument()
})

test('SearchBar é uma busca por GET, com rótulos e filtro, e limpar só aparece com filtro ativo', () => {
  const filtros = [
    {
      name: 'status',
      label: 'Situação',
      value: 'ACTIVE',
      options: [
        { value: '', label: 'Todas' },
        { value: 'ACTIVE', label: 'Ativas' },
      ],
    },
  ]
  render(<SearchBar action="/contas" label="Buscar contas" query="pata" filters={filtros} clearHref="/contas" />)
  const form = screen.getByRole('search')
  expect(form).toHaveAttribute('method', 'get')
  expect(form).toHaveAttribute('action', '/contas')
  expect(screen.getByLabelText('Buscar contas')).toHaveValue('pata')
  expect(screen.getByLabelText('Situação')).toHaveValue('ACTIVE')
  expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Limpar busca' })).toHaveAttribute('href', '/contas')
})

test('SearchBar sem busca nem filtro não mostra "Limpar busca"', () => {
  render(<SearchBar action="/contas" label="Buscar contas" query="" filters={[]} clearHref="/contas" />)
  expect(screen.queryByRole('link', { name: 'Limpar busca' })).toBeNull()
})

test('FormErrors anuncia a mensagem e lista os campos com erro', () => {
  render(<FormErrors message="Corrija os campos abaixo." fields={{ slug: 'Use de 3 a 40 letras.' }} labels={{ slug: 'Identificador' }} />)
  const alerta = screen.getByRole('alert')
  expect(alerta).toHaveTextContent('Corrija os campos abaixo.')
  expect(alerta).toHaveTextContent('Identificador: Use de 3 a 40 letras.')
})

test('FormErrors leva ao campo por âncora quando se sabe o id dele', () => {
  render(<FormErrors message={null} fields={{ slug: 'Use de 3 a 40 letras.', nome: 'Informe o nome.' }} labels={{ slug: 'Identificador' }} anchors={{ slug: 'campo-slug' }} />)
  expect(screen.getByRole('link', { name: 'Identificador' })).toHaveAttribute('href', '#campo-slug')
  expect(screen.queryByRole('link', { name: 'nome' })).toBeNull()
})

test('FormErrors não desenha nada sem erro', () => {
  const { container } = render(<FormErrors message={null} fields={{}} />)
  expect(container).toBeEmptyDOMElement()
})

test('CopyButton copia o texto e avisa em texto', async () => {
  const escrever = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true })
  render(<CopyButton text="http://loja.test/pata" label="Copiar link" />)
  await userEvent.click(screen.getByRole('button', { name: 'Copiar link' }))
  expect(escrever).toHaveBeenCalledWith('http://loja.test/pata')
  expect(await screen.findByText('Copiado')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Copiado para a área de transferência.')
})
