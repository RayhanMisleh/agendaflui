// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflitosAviso, ConflitosDialog } from '@/app/app/painel/agenda/ConflitosDialog'
import type { Confirmacao } from '@/app/_lib/form-state'

const confirmacao: Confirmacao = {
  ack: 'abc123',
  professionalName: 'Ana',
  issues: [
    { kind: 'outside_hours', text: 'Fora do expediente de Ana' },
    { kind: 'busy', text: '14:00–15:00 já tem Rex (Banho)' },
  ],
}

test('ConflitosDialog lista os textos e o botão envia name=ack value=<ack> no formulário indicado', async () => {
  const enviado = vi.fn()
  render(
    <>
      <form
        id="f"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)
          enviado(fd.get('ack'))
        }}
      />
      <ConflitosDialog formId="f" confirmation={confirmacao} confirmLabel="Marcar mesmo assim" />
    </>,
  )
  expect(screen.getByRole('dialog', { name: 'Confirme o horário' })).toBeInTheDocument()
  expect(screen.getByText('Fora do expediente de Ana')).toBeInTheDocument()
  expect(screen.getByText('14:00–15:00 já tem Rex (Banho)')).toBeInTheDocument()
  expect(screen.getByText('Vai ficar como encaixe se sobrepor outro atendimento.')).toBeInTheDocument()
  const botao = screen.getByRole('button', { name: 'Marcar mesmo assim' })
  expect(botao).toHaveAttribute('form', 'f')
  expect(botao).toHaveAttribute('name', 'ack')
  expect(botao).toHaveAttribute('value', 'abc123')
  await userEvent.click(botao)
  expect(enviado).toHaveBeenCalledWith('abc123')
})

test('Voltar fecha o diálogo e uma impressão nova abre de novo', async () => {
  const { rerender } = render(<ConflitosDialog formId="f" confirmation={confirmacao} confirmLabel="Salvar mesmo assim" />)
  await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<ConflitosDialog formId="f" confirmation={{ ...confirmacao, ack: 'novo' }} confirmLabel="Salvar mesmo assim" />)
  expect(await screen.findByRole('dialog', { name: 'Confirme o horário' })).toBeInTheDocument()
})

test('sem confirmação não abre; ConflitosAviso leva o ack escondido', () => {
  const { container } = render(
    <>
      <ConflitosDialog formId="f" confirmation={undefined} confirmLabel="Marcar mesmo assim" />
      <ConflitosAviso confirmation={confirmacao} />
    </>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(container.querySelector('input[type="hidden"][name="ack"]')).toHaveValue('abc123')
  expect(screen.getByText('Fora do expediente de Ana')).toBeInTheDocument()
})
