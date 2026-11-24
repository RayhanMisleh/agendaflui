// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CadastroForm } from '@/app/app/[slug]/cadastro/CadastroForm'
import type { EstadoCadastro } from '@/app/app/[slug]/cadastro/actions'

const acoes = vi.hoisted(() => ({ pedirCodigo: vi.fn(), confirmarCadastro: vi.fn() }))
vi.mock('@/app/app/[slug]/cadastro/actions', () => acoes)

const enviado = (sent: number): EstadoCadastro => ({ step: 'codigo', error: null, fields: {}, values: { name: 'Ana', email: 'ana@exemplo.test', phone: '' }, sent })

function preencher(): void {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } })
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@exemplo.test' } })
  fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'senha-bem-longa' } })
}

beforeEach(() => {
  acoes.pedirCodigo.mockReset()
  acoes.confirmarCadastro.mockReset()
  acoes.confirmarCadastro.mockResolvedValue({ error: null, fields: {} })
})

test('depois de enviar os dados, mostra o passo do código com o e-mail e o botão de reenviar', async () => {
  acoes.pedirCodigo.mockResolvedValue(enviado(1))
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(await screen.findByText(/Enviamos um código para ana@exemplo.test\./)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeEnabled()
  expect(screen.getByLabelText('Código de 6 dígitos')).toHaveAttribute('autocomplete', 'one-time-code')
  expect(screen.getByRole('button', { name: 'Confirmar e entrar' })).toBeInTheDocument()
  const enviadoAoServidor = acoes.pedirCodigo.mock.calls[0]?.[1] as FormData
  expect(enviadoAoServidor.get('slug')).toBe('pet-bom')
  expect(enviadoAoServidor.get('email')).toBe('ana@exemplo.test')
})

test('reenviar código reenvia os dados guardados (com a senha) e avisa que enviou outro', async () => {
  acoes.pedirCodigo.mockResolvedValueOnce(enviado(1)).mockResolvedValueOnce(enviado(2))
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reenviar código' }))
  await waitFor(() => expect(acoes.pedirCodigo).toHaveBeenCalledTimes(2))
  const segunda = acoes.pedirCodigo.mock.calls[1]?.[1] as FormData
  expect(segunda.get('password')).toBe('senha-bem-longa')
  expect(segunda.get('email')).toBe('ana@exemplo.test')
  expect(await screen.findByText(/Enviamos outro código/)).toBeInTheDocument()
})

test('trocar e-mail volta aos dados com o que foi digitado, sem a senha', async () => {
  acoes.pedirCodigo.mockResolvedValue(enviado(1))
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trocar e-mail' }))
  expect(await screen.findByLabelText('E-mail')).toHaveValue('ana@exemplo.test')
  expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
  expect(screen.getByLabelText(/^Senha/)).toHaveValue('')
})

test('erro de campo e erro geral aparecem com role="alert" e o formulário mantém o que foi digitado', async () => {
  acoes.pedirCodigo.mockResolvedValue({ step: 'dados', error: 'Esta loja não está disponível agora.', fields: { email: 'Informe um e-mail válido.' }, values: { name: 'Ana', email: 'x', phone: '' }, sent: 0 })
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Esta loja não está disponível agora.')
  expect(screen.getByLabelText('E-mail')).toHaveValue('x')
})

test('código errado mostra o erro no campo do código', async () => {
  acoes.pedirCodigo.mockResolvedValue(enviado(1))
  acoes.confirmarCadastro.mockResolvedValue({ error: null, fields: { code: 'Código incorreto ou vencido.' } })
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e entrar' }))
  expect(await screen.findByText('Código incorreto ou vencido.')).toBeInTheDocument()
})

test('reenviar código roda dentro de uma transição (sem aviso do React e com o botão em andamento)', async () => {
  const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
  let liberar: (e: EstadoCadastro) => void = () => {}
  acoes.pedirCodigo.mockResolvedValueOnce(enviado(1)).mockImplementationOnce(() => new Promise<EstadoCadastro>((r) => { liberar = r }))
  render(<CadastroForm slug="pet-bom" />)
  preencher()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reenviar código' }))
  await waitFor(() => expect(acoes.pedirCodigo).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: /Reenviar código/ })).toBeDisabled()
  liberar(enviado(2))
  expect(await screen.findByText(/Enviamos outro código/)).toBeInTheDocument()
  expect(erro.mock.calls.some((c) => String(c[0]).includes('outside of a transition'))).toBe(false)
  erro.mockRestore()
})
