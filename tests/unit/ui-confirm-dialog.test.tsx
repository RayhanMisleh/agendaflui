// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog, ConfirmForm } from '@/ui/components/ConfirmDialog'

type Estado = { ok: boolean; message: string | null; fields: Record<string, string> }
const inicial: Estado = { ok: false, message: null, fields: {} }
const acao = async () => inicial

test('o botão só habilita com o nome exato do alvo', async () => {
  render(<ConfirmDialog open onClose={() => {}} title="Arquivar conta" targetName="Pata Viva" confirmLabel="Arquivar conta" action={acao} initialState={inicial} />)
  const botao = screen.getByRole('button', { name: 'Arquivar conta' })
  expect(botao).toBeDisabled()
  const campo = screen.getByLabelText(/Digite Pata Viva/)
  await userEvent.type(campo, 'pata viva')
  expect(botao).toBeDisabled()
  await userEvent.clear(campo)
  await userEvent.type(campo, 'Pata Viva')
  expect(botao).toBeEnabled()
})

test('o diálogo tem nome acessível e o campo manda confirmName', () => {
  render(<ConfirmDialog open onClose={() => {}} title="Arquivar conta" targetName="Pata Viva" confirmLabel="Arquivar" action={acao} initialState={inicial} />)
  expect(screen.getByRole('dialog', { name: 'Arquivar conta' })).toBeInTheDocument()
  expect(screen.getByLabelText(/Digite Pata Viva/)).toHaveAttribute('name', 'confirmName')
})

test('campos escondidos acompanham o envio', () => {
  const { container } = render(
    <ConfirmForm targetName="X" confirmLabel="Sim" action={acao} initialState={inicial} hidden={{ businessId: 'b-1', to: 'ARCHIVED' }} />,
  )
  expect(container.querySelector('input[type="hidden"][name="businessId"]')).toHaveValue('b-1')
  expect(container.querySelector('input[type="hidden"][name="to"]')).toHaveValue('ARCHIVED')
})

test('sem nome de alvo (ação não destrutiva) o botão já vem habilitado e não pede digitação', () => {
  render(<ConfirmForm confirmLabel="Reativar" action={acao} initialState={inicial} />)
  expect(screen.getByRole('button', { name: 'Reativar' })).toBeEnabled()
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('o erro do servidor aparece ligado ao campo de confirmação', async () => {
  const comErro = async (): Promise<Estado> => ({ ok: false, message: 'Digite o nome da conta exatamente como aparece, para confirmar.', fields: { confirmName: 'Digite o nome da conta exatamente como aparece, para confirmar.' } })
  render(<ConfirmForm targetName="Pata" confirmLabel="Arquivar" action={comErro} initialState={inicial} />)
  await userEvent.type(screen.getByLabelText(/Digite Pata/), 'Pata')
  await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }))
  const campo = await screen.findByLabelText(/Digite Pata/)
  expect(campo).toHaveAttribute('aria-invalid', 'true')
  expect(campo).toHaveAccessibleDescription(/exatamente como aparece/)
})

test('cancelar chama onClose', async () => {
  const onClose = vi.fn()
  render(<ConfirmDialog open onClose={onClose} title="Arquivar" targetName="X" confirmLabel="Arquivar" action={acao} initialState={inicial} />)
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(onClose).toHaveBeenCalled()
})
