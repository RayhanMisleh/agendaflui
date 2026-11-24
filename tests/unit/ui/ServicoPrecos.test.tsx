// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServicoPrecos } from '@/app/app/painel/servicos/ServicoPrecos'

const props = { step: 15, prices: [], valores: {}, erros: {}, novo: true }

test('sem servesCats não renderiza a linha Gato e, com ele, renderiza', () => {
  const { rerender } = render(<ServicoPrecos {...props} servesCats={false} />)
  const lista = screen.getByRole('list', { name: /Preço e duração/ })
  expect(within(lista).getAllByRole('listitem')).toHaveLength(4)
  expect(screen.queryByText('Gato')).not.toBeInTheDocument()
  rerender(<ServicoPrecos {...props} servesCats />)
  expect(within(screen.getByRole('list', { name: /Preço e duração/ })).getAllByRole('listitem')).toHaveLength(5)
  expect(screen.getByText('Gato')).toBeInTheDocument()
})

test('as linhas mostram o porte e a faixa de peso', () => {
  render(<ServicoPrecos {...props} servesCats={false} />)
  expect(screen.getByText('Pequeno · até 10 kg')).toBeInTheDocument()
  expect(screen.getByText('Gigante · acima de 45 kg')).toBeInTheDocument()
})

test('desmarcar "Atende" desabilita os campos da linha', async () => {
  render(<ServicoPrecos {...props} servesCats={false} />)
  const linha = screen.getByText('Médio · 10 a 25 kg').closest('li') as HTMLElement
  const preco = linha.querySelector<HTMLInputElement>('[name="v_DOG_MEDIUM_price"]')
  const duracao = linha.querySelector<HTMLSelectElement>('[name="v_DOG_MEDIUM_duration"]')
  expect(preco).toBeEnabled()
  await userEvent.click(within(linha).getByRole('checkbox'))
  expect(preco).toBeDisabled()
  expect(duracao).toBeDisabled()
  expect(linha).toHaveClass('af-varrow--off')
})

test('linha de gato guardada com gatos desligados avisa que fica guardada', () => {
  render(<ServicoPrecos {...props} servesCats={false} novo={false} prices={[{ variant: 'CAT', priceCents: 7000, durationMin: 60 }]} />)
  expect(screen.getByText('A linha de gato fica guardada enquanto a loja não atende gatos.')).toBeInTheDocument()
})

test('preços gravados voltam nos campos e erro de linha aparece no campo', () => {
  render(
    <ServicoPrecos
      {...props}
      servesCats={false}
      novo={false}
      prices={[{ variant: 'DOG_SMALL', priceCents: 5000, durationMin: 60 }]}
      erros={{ v_DOG_SMALL_price: 'Informe o preço.' }}
    />,
  )
  expect(document.querySelector<HTMLInputElement>('[name="v_DOG_SMALL_price"]')?.value).toBe('50,00')
  expect(screen.getByText('Informe o preço.')).toBeInTheDocument()
  // Só a linha gravada fica marcada num serviço existente.
  expect(document.querySelector('[name="v_DOG_LARGE_price"]')).toBeDisabled()
})
