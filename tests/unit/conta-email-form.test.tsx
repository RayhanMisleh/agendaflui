// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '@/ui/components'
import { EmailForm } from '@/app/app/conta/_partes/EmailForm'
import { ESTADO_CONTA } from '@/app/app/conta/_lib/estado'

const acoes = vi.hoisted(() => ({ pedirCodigoDeEmail: vi.fn(), confirmarEmail: vi.fn() }))
vi.mock('@/app/app/conta/actions', () => acoes)

const AVISO = 'O Google vinculado usa outro e-mail e será desvinculado.'

beforeEach(() => {
  acoes.pedirCodigoDeEmail.mockReset()
  acoes.confirmarEmail.mockReset()
})

function abrir(google: { email: string } | null = { email: 'rita@gmail.test' }, hasPassword = true): void {
  render(
    <ToastProvider>
      <EmailForm email="rita@exemplo.test" google={google} hasPassword={hasPassword} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }))
}

test('mostra "O Google vinculado usa outro e-mail e será desvinculado." quando o e-mail novo difere do Google', () => {
  abrir()
  fireEvent.change(screen.getByLabelText('Novo e-mail'), { target: { value: 'novo@exemplo.test' } })
  expect(screen.getByText(AVISO)).toBeInTheDocument()
})

test('não mostra quando é o mesmo e-mail do Google', () => {
  abrir()
  fireEvent.change(screen.getByLabelText('Novo e-mail'), { target: { value: 'Rita@Gmail.test' } })
  expect(screen.queryByText(AVISO)).not.toBeInTheDocument()
})

test('não mostra quando a pessoa não tem Google', () => {
  abrir(null)
  fireEvent.change(screen.getByLabelText('Novo e-mail'), { target: { value: 'novo@exemplo.test' } })
  expect(screen.queryByText(AVISO)).not.toBeInTheDocument()
})

test('passo do código aparece depois de "Enviar código"', async () => {
  acoes.pedirCodigoDeEmail.mockResolvedValue({ ...ESTADO_CONTA, step: 'codigo', sent: 1, values: { email: 'novo@exemplo.test' } })
  abrir()
  fireEvent.change(screen.getByLabelText('Novo e-mail'), { target: { value: 'novo@exemplo.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect(await screen.findByText(/Enviamos um código para novo@exemplo.test/)).toBeInTheDocument()
  expect(screen.getByLabelText('Código de 6 dígitos')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeInTheDocument()
  expect(screen.getByText(AVISO)).toBeInTheDocument()
})

test('sem senha e só Google: mostra "Criar senha" quando a ação pede senha', async () => {
  acoes.pedirCodigoDeEmail.mockResolvedValue({ ...ESTADO_CONTA, needsPassword: true, message: 'Crie uma senha antes de trocar o e-mail.' })
  abrir({ email: 'rita@exemplo.test' }, false)
  fireEvent.change(screen.getByLabelText('Novo e-mail'), { target: { value: 'novo@exemplo.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Crie uma senha antes de trocar o e-mail.')
  expect(screen.getByRole('link', { name: 'Criar senha' })).toHaveAttribute('href', '#senha')
})
