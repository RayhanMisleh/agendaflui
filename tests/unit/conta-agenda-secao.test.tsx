// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '@/ui/components'
import { GoogleSecao } from '@/app/app/conta/_partes/GoogleSecao'
import { AgendaGoogleSecao } from '@/app/app/conta/_partes/AgendaGoogleSecao'

const acoes = vi.hoisted(() => ({ desligarAgenda: vi.fn() }))
vi.mock('@/app/app/conta/actions', () => acoes)

function abrir(o: Partial<React.ComponentProps<typeof AgendaGoogleSecao>> = {}): void {
  render(
    <ToastProvider>
      <AgendaGoogleSecao state="off" available hasGoogle syncedLabel={null} {...o} />
    </ToastProvider>,
  )
}

test('revogada mostra "Desligada — ligue de novo" e o botão "Ligar de novo"', () => {
  abrir({ state: 'revoked' })
  expect(screen.getByText('Desligada — ligue de novo')).toBeInTheDocument()
  expect(screen.getByText('O Google recusou o acesso. Ligue de novo para voltar a enviar.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ligar de novo' })).toBeInTheDocument()
})

test('ligada mostra "Desligar"; sem Google vinculado não mostra botão', () => {
  abrir({ state: 'on', syncedLabel: '24/11/2026 12:30' })
  expect(screen.getByText('Ligada')).toBeInTheDocument()
  expect(screen.getByText('Atualizada em 24/11/2026 12:30.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Desligar' })).toBeInTheDocument()
})

test('ligada sem envio ainda diz que está enviando', () => {
  abrir({ state: 'on' })
  expect(screen.getByText('Enviando seus atendimentos…')).toBeInTheDocument()
})

test('desligada: botão "Ligar Google Agenda"; sem Google vinculado, só a dica', () => {
  abrir()
  expect(screen.getByRole('button', { name: 'Ligar Google Agenda' })).toBeInTheDocument()
})

test('sem Google vinculado não mostra botão e pede para vincular', () => {
  abrir({ hasGoogle: false, available: false })
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText('Vincule o Google acima para ligar a agenda.')).toBeInTheDocument()
})

test('Desligar pede confirmação antes de chamar a ação', () => {
  abrir({ state: 'on' })
  fireEvent.click(screen.getByRole('button', { name: 'Desligar' }))
  expect(screen.getByText('Desligar a agenda?')).toBeInTheDocument()
  expect(screen.getByText('Os eventos já enviados ficam na sua agenda do Google.')).toBeInTheDocument()
  expect(acoes.desligarAgenda).not.toHaveBeenCalled()
})

test('a seção leva o id "agenda" para o destino do retorno do Google', () => {
  abrir()
  expect(document.getElementById('agenda')).not.toBeNull()
})

test('desvincular o Google avisa que a Google Agenda também desliga, só quando ela está ligada', () => {
  const { unmount } = render(
    <ToastProvider>
      <GoogleSecao google={{ email: 'a@x.test' }} hasPassword email="a@x.test" agendaLigada />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }))
  expect(screen.getByText(/A Google Agenda também será desligada; os eventos já enviados ficam lá\./)).toBeInTheDocument()
  unmount()
  render(
    <ToastProvider>
      <GoogleSecao google={{ email: 'a@x.test' }} hasPassword email="a@x.test" />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }))
  expect(screen.queryByText(/Google Agenda também/)).toBeNull()
})
