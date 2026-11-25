// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EnderecoForm } from '@/app/app/[slug]/(area)/loja/enderecos/EnderecoForm'
import { FinalizarForm, type OpcoesDaLoja } from '@/app/app/[slug]/(area)/loja/finalizar/FinalizarForm'
import { ToastProvider } from '@/ui/components'

const mocks = vi.hoisted(() => ({ cotarFrete: vi.fn(), buscarCep: vi.fn() }))
vi.mock('@/app/app/[slug]/(area)/loja/actions', () => ({ fazerPedido: vi.fn(), salvarEndereco: vi.fn(), apagarEndereco: vi.fn() }))
vi.mock('@/app/app/[slug]/(area)/loja/consultas', () => mocks)

const resumo = { linhas: [{ name: 'Shampoo', quantity: 2, totalCents: 5000 }], itemsCents: 5000 }
const casa = { id: 'a1', label: 'Casa', recipientName: 'Maria', postalCode: '20040-020', street: 'Rua da Quitanda', number: '10', complement: null, district: 'Centro', city: 'Rio de Janeiro', state: 'RJ', isDefault: true }
const retirada: OpcoesDaLoja = { pickup: { enabled: true, instructions: 'Retire de segunda a sexta.' }, shipping: { enabled: false }, payment: { available: true } }

function ver(options: OpcoesDaLoja, enderecos = [casa]) {
  return render(
    <ToastProvider>
      <FinalizarForm slug="loja-a" options={options} enderecos={enderecos} resumo={resumo} nomeInicial="Maria" chave="chave-1" />
    </ToastProvider>,
  )
}

beforeEach(() => {
  mocks.cotarFrete.mockReset()
  mocks.buscarCep.mockReset()
})

describe('FinalizarForm', () => {
  test('sem entrega ligada só aparece "Retirar na loja", com as instruções', () => {
    ver(retirada)
    expect(screen.getByRole('radio', { name: /Retirar na loja/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /Entregar no endereço/ })).toBeNull()
    expect(screen.getByText('Retire de segunda a sexta.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir para o pagamento' })).toBeEnabled()
    expect(mocks.cotarFrete).not.toHaveBeenCalled()
  })

  test('pagamento indisponível desabilita "Ir para o pagamento" e mostra o aviso', () => {
    ver({ ...retirada, payment: { available: false } })
    expect(screen.getByRole('button', { name: 'Ir para o pagamento' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('A loja ainda não recebe pagamento por aqui. Fale com a loja.')
  })

  test('o formulário leva o modo, a chave e nada de preço; o recado é opcional', () => {
    const { container } = ver(retirada)
    const valor = (nome: string) => (container.querySelector(`input[type="hidden"][name="${nome}"]`) as HTMLInputElement | null)?.value
    expect(valor('delivery')).toBe('PICKUP')
    expect(valor('key')).toBe('chave-1')
    expect(container.querySelector('input[name="totalCents"], input[name="shippingCents"], input[name="price"]')).toBeNull()
    expect(screen.getByLabelText(/Recado/)).toBeInTheDocument()
  })

  test('com entrega: escolher o endereço cota o frete, mostra as opções e o total soma o frete escolhido', async () => {
    mocks.cotarFrete.mockResolvedValue({
      ok: true,
      cotacao: {
        pickup: { available: true, instructions: null },
        options: [
          { serviceCode: 'PAC', name: 'PAC', carrier: 'Correios', priceCents: 2150, days: 7, quoteToken: 'tok-pac' },
          { serviceCode: 'SEDEX', name: 'SEDEX', carrier: 'Correios', priceCents: 3890, days: 3, quoteToken: 'tok-sedex' },
        ],
        shippingError: null,
      },
    })
    const { container } = ver({ ...retirada, shipping: { enabled: true } })
    fireEvent.click(screen.getByRole('radio', { name: /Entregar no endereço/ }))
    expect(await screen.findByRole('radio', { name: /Correios · PAC/ })).toBeChecked()
    expect(mocks.cotarFrete).toHaveBeenCalledWith('loja-a', 'a1')
    expect(screen.getByText(/até 7 dias úteis/)).toBeInTheDocument()
    expect(screen.getByText('R$ 71,50')).toBeInTheDocument()
    const valor = (nome: string) => (container.querySelector(`input[type="hidden"][name="${nome}"]`) as HTMLInputElement).value
    expect(valor('delivery')).toBe('SHIPPING')
    expect(valor('addressId')).toBe('a1')
    expect(valor('quoteToken')).toBe('tok-pac')
    fireEvent.click(screen.getByRole('radio', { name: /Correios · SEDEX/ }))
    expect(valor('quoteToken')).toBe('tok-sedex')
    expect(screen.getByText('R$ 88,90')).toBeInTheDocument()
  })

  test('entrega sem opção: mostra o motivo e não deixa seguir', async () => {
    mocks.cotarFrete.mockResolvedValue({ ok: true, cotacao: { pickup: { available: true, instructions: null }, options: [], shippingError: 'A entrega não está disponível agora. Você pode retirar no local.' } })
    ver({ ...retirada, shipping: { enabled: true } })
    fireEvent.click(screen.getByRole('radio', { name: /Entregar no endereço/ }))
    expect(await screen.findByText('A entrega não está disponível agora. Você pode retirar no local.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir para o pagamento' })).toBeDisabled()
  })

  test('entrega sem endereço salvo pede para cadastrar um', () => {
    ver({ ...retirada, shipping: { enabled: true } }, [])
    fireEvent.click(screen.getByRole('radio', { name: /Entregar no endereço/ }))
    expect(screen.getByText(/ainda não tem endereço salvo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir para o pagamento' })).toBeDisabled()
    expect(mocks.cotarFrete).not.toHaveBeenCalled()
  })
})

describe('EnderecoForm', () => {
  test('CEP preenche rua, bairro, cidade e estado', async () => {
    mocks.buscarCep.mockResolvedValue({ ok: true, endereco: { street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }, indisponivel: false })
    render(<EnderecoForm slug="loja-a" endereco={null} nomeInicial="Maria" />)
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '01310100' } })
    await waitFor(() => expect(screen.getByLabelText('Rua')).toHaveValue('Rua das Flores'))
    expect(mocks.buscarCep).toHaveBeenCalledWith('loja-a', '01310100')
    expect(screen.getByLabelText('CEP')).toHaveValue('01310-100')
    expect(screen.getByLabelText('Bairro')).toHaveValue('Centro')
    expect(screen.getByLabelText('Cidade')).toHaveValue('São Paulo')
    expect(screen.getByLabelText('Estado')).toHaveValue('SP')
    expect(screen.getByLabelText('Nome de quem recebe')).toHaveValue('Maria')
  })

  test('CEP que não existe ou serviço fora do ar: avisa e deixa digitar', async () => {
    mocks.buscarCep.mockResolvedValueOnce({ ok: true, endereco: null, indisponivel: false }).mockResolvedValueOnce({ ok: true, endereco: null, indisponivel: true })
    render(<EnderecoForm slug="loja-a" endereco={null} />)
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '00000000' } })
    expect(await screen.findByText(/CEP não encontrado/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '99999999' } })
    expect(await screen.findByText(/Não deu para buscar o CEP agora/)).toBeInTheDocument()
    expect(screen.getByLabelText('Rua')).toBeEnabled()
  })

  test('editar traz os campos do endereço e não busca o CEP de novo', () => {
    render(<EnderecoForm slug="loja-a" endereco={casa} />)
    expect(screen.getByLabelText('Rua')).toHaveValue('Rua da Quitanda')
    expect(screen.getByLabelText('Estado')).toHaveValue('RJ')
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('a1')
    expect(mocks.buscarCep).not.toHaveBeenCalled()
  })
})
