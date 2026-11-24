// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CadastroQuiz } from '@/app/app/[slug]/(acesso)/cadastro/CadastroQuiz'

const acoes = vi.hoisted(() => ({ pedirCodigo: vi.fn(), confirmarCadastro: vi.fn(), concluirCadastro: vi.fn() }))
vi.mock('@/app/app/[slug]/(acesso)/cadastro/actions', () => acoes)

const OK = { ok: true, error: null, fields: {} }
const falha = (fields: Record<string, string> = {}, error: string | null = null) => ({ ok: false, error, fields })

const digitar = (rotulo: string | RegExp, valor: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } })
const clicar = (nome: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: nome }))

async function ateOCodigo(): Promise<void> {
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  digitar('E-mail', 'ana@exemplo.test')
  digitar('Senha', 'senha-bem-longa')
  clicar('Enviar código')
  await screen.findByRole('heading', { name: 'Confirme o seu e-mail' })
}

async function ateOWhatsapp(): Promise<void> {
  await ateOCodigo()
  digitar('Código de 6 dígitos', '123456')
  await screen.findByRole('heading', { name: 'Qual é o seu WhatsApp?' })
}

beforeEach(() => {
  acoes.pedirCodigo.mockReset().mockResolvedValue(OK)
  acoes.confirmarCadastro.mockReset().mockResolvedValue(OK)
  acoes.concluirCadastro.mockReset().mockResolvedValue(OK)
})

test('começa pelo nome, com a barra no primeiro de quatro passos e o Google como abertura', () => {
  render(<CadastroQuiz slug="pet-bom" abertura={<p>abertura-google</p>} />)
  expect(screen.getByRole('heading', { level: 1, name: 'Como te chamamos?' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 de 4')
  expect(screen.getByText('abertura-google')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull()
})

test('nome vazio ou de uma letra não avança e mostra o erro no campo', () => {
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', ' A ')
  clicar('Continuar')
  expect(screen.getByText('Informe seu nome.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Como te chamamos?' })).toBeInTheDocument()
})

test('e-mail inválido e senha curta não chamam o servidor', () => {
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  digitar('E-mail', 'ana@')
  digitar('Senha', 'curta')
  clicar('Enviar código')
  expect(screen.getByText(/Informe um e-mail válido/)).toBeInTheDocument()
  expect(screen.getByText('A senha precisa de 10 caracteres ou mais.')).toBeInTheDocument()
  expect(acoes.pedirCodigo).not.toHaveBeenCalled()
})

test('o botão de mostrar senha alterna o tipo do campo', () => {
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  const campo = screen.getByLabelText('Senha')
  expect(campo).toHaveAttribute('type', 'password')
  clicar('Mostrar senha')
  expect(campo).toHaveAttribute('type', 'text')
  expect(screen.getByRole('button', { name: 'Esconder senha' })).toHaveAttribute('aria-pressed', 'true')
})

test('envia nome, e-mail e senha (sem telefone) e passa para o código, com o passo anunciado', async () => {
  render(<CadastroQuiz slug="pet-bom" volta="/pet-bom/agendar" />)
  await ateOCodigo()
  const enviado = acoes.pedirCodigo.mock.calls[0]?.[0] as FormData
  expect(enviado.get('slug')).toBe('pet-bom')
  expect(enviado.get('name')).toBe('Ana')
  expect(enviado.get('email')).toBe('ana@exemplo.test')
  expect(enviado.get('password')).toBe('senha-bem-longa')
  expect(enviado.get('volta')).toBe('/pet-bom/agendar')
  expect(enviado.has('phone')).toBe(false)
  expect(screen.getByText(/Enviamos um código de 6 dígitos para ana@exemplo.test/)).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 de 4')
  expect(screen.getByText('Passo 3 de 4: Confirme o seu e-mail')).toBeInTheDocument()
})

test('erro do servidor no e-mail mostra no campo e fica no passo', async () => {
  acoes.pedirCodigo.mockResolvedValue(falha({ email: 'Este e-mail já tem conta. Entre com ela.' }))
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  digitar('E-mail', 'ana@exemplo.test')
  digitar('Senha', 'senha-bem-longa')
  clicar('Enviar código')
  expect(await screen.findByText('Este e-mail já tem conta. Entre com ela.')).toBeInTheDocument()
  expect(screen.getByLabelText('E-mail')).toHaveValue('ana@exemplo.test')
})

test('erro de nome vindo do servidor volta ao passo do nome', async () => {
  acoes.pedirCodigo.mockResolvedValue(falha({ name: 'Informe o nome.' }))
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  digitar('E-mail', 'ana@exemplo.test')
  digitar('Senha', 'senha-bem-longa')
  clicar('Enviar código')
  expect(await screen.findByRole('heading', { name: 'Como te chamamos?' })).toBeInTheDocument()
  expect(screen.getByText('Informe o nome.')).toBeInTheDocument()
})

test('voltar e trocar e-mail levam ao passo anterior sem perder o que foi digitado', async () => {
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOCodigo()
  clicar('Trocar e-mail')
  expect(screen.getByLabelText('E-mail')).toHaveValue('ana@exemplo.test')
  expect(screen.getByLabelText('Senha')).toHaveValue('senha-bem-longa')
  clicar('Voltar')
  expect(screen.getByLabelText('Seu nome')).toHaveValue('Ana')
})

test('código completo confirma sozinho e abre o passo do WhatsApp; o servidor recebe o e-mail e o código', async () => {
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOWhatsapp()
  const enviado = acoes.confirmarCadastro.mock.calls[0]?.[0] as FormData
  expect(enviado.get('email')).toBe('ana@exemplo.test')
  expect(enviado.get('code')).toBe('123456')
  expect(screen.getByText('Conta criada. Falta só uma coisa.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '4 de 4')
})

test('código com letras fica só com dígitos e menos de 6 não confirma', async () => {
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOCodigo()
  digitar('Código de 6 dígitos', '12ab3')
  expect(screen.getByLabelText('Código de 6 dígitos')).toHaveValue('123')
  clicar('Confirmar')
  expect(screen.getByText(/Informe o código de 6 dígitos/)).toBeInTheDocument()
  expect(acoes.confirmarCadastro).not.toHaveBeenCalled()
})

test('código errado mostra o erro no campo e não avança', async () => {
  acoes.confirmarCadastro.mockResolvedValue(falha({ code: 'Código incorreto ou vencido.' }))
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOCodigo()
  digitar('Código de 6 dígitos', '123456')
  expect(await screen.findByText('Código incorreto ou vencido.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Confirme o seu e-mail' })).toBeInTheDocument()
})

test('reenviar código usa os dados guardados (com a senha), espera 30 s e avisa que enviou outro', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    render(<CadastroQuiz slug="pet-bom" />)
    await ateOCodigo()
    expect(screen.getByRole('button', { name: /Reenviar código em \d+ s/ })).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    clicar('Reenviar código')
    await waitFor(() => expect(acoes.pedirCodigo).toHaveBeenCalledTimes(2))
    const segundo = acoes.pedirCodigo.mock.calls[1]?.[0] as FormData
    expect(segundo.get('password')).toBe('senha-bem-longa')
    expect(await screen.findByText(/Enviamos outro código/)).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('o WhatsApp é mascarado e enviado ao concluir', async () => {
  render(<CadastroQuiz slug="pet-bom" volta="/pet-bom/agendar" />)
  await ateOWhatsapp()
  digitar('WhatsApp', '11912345678')
  expect(screen.getByLabelText('WhatsApp')).toHaveValue('(11) 91234-5678')
  clicar('Concluir')
  await waitFor(() => expect(acoes.concluirCadastro).toHaveBeenCalledTimes(1))
  const enviado = acoes.concluirCadastro.mock.calls[0]?.[0] as FormData
  expect(enviado.get('phone')).toBe('(11) 91234-5678')
  expect(enviado.get('slug')).toBe('pet-bom')
  expect(enviado.get('volta')).toBe('/pet-bom/agendar')
})

test('pular conclui sem telefone', async () => {
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOWhatsapp()
  digitar('WhatsApp', '11912345678')
  clicar('Pular por agora')
  await waitFor(() => expect(acoes.concluirCadastro).toHaveBeenCalledTimes(1))
  expect((acoes.concluirCadastro.mock.calls[0]?.[0] as FormData).get('phone')).toBe('')
})

test('telefone recusado pelo servidor mostra o erro no campo e o passo continua', async () => {
  acoes.concluirCadastro.mockResolvedValue(falha({ phone: 'Telefone inválido.' }))
  render(<CadastroQuiz slug="pet-bom" />)
  await ateOWhatsapp()
  digitar('WhatsApp', '11912345678')
  clicar('Concluir')
  expect(await screen.findByText('Telefone inválido.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Qual é o seu WhatsApp?' })).toBeInTheDocument()
})

test('Enter no campo envia o passo (formulário de verdade)', () => {
  render(<CadastroQuiz slug="pet-bom" />)
  digitar('Seu nome', 'Ana')
  fireEvent.submit(screen.getByLabelText('Seu nome').closest('form')!)
  expect(screen.getByRole('heading', { name: 'Seu e-mail e uma senha' })).toBeInTheDocument()
})

test('depois do primeiro passo o quiz se marca como "fundo" (as abas da loja somem) e a foco vai para o campo', async () => {
  const { container } = render(<CadastroQuiz slug="pet-bom" />)
  expect(container.querySelector('[data-entry-deep]')).toBeNull()
  digitar('Seu nome', 'Ana')
  clicar('Continuar')
  expect(container.querySelector('[data-entry-deep]')).not.toBeNull()
  await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
})
