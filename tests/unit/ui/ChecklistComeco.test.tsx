// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { ChecklistComeco, mostraChecklist } from '@/app/app/painel/_lib/ChecklistComeco'
import type { OnboardingView } from '@/server/domain/onboarding/progress'

const PASSOS: OnboardingView['steps'] = [
  { key: 'STORE', slug: 'loja', label: 'Dados da loja', status: 'done' },
  { key: 'BRAND', slug: 'marca', label: 'Marca', status: 'done' },
  { key: 'ANIMALS', slug: 'animais', label: 'Animais atendidos', status: 'done' },
  { key: 'SERVICES', slug: 'servicos', label: 'Serviços', status: 'done' },
  { key: 'HOURS', slug: 'expediente', label: 'Expediente', status: 'skipped' },
  { key: 'TEAM', slug: 'equipe', label: 'Equipe', status: 'todo' },
  { key: 'LINK', slug: 'link', label: 'Link para clientes', status: 'todo' },
]
const view = (o: Partial<OnboardingView> = {}): OnboardingView => ({
  steps: PASSOS,
  done: 4,
  total: 7,
  current: 'TEAM',
  wizardFinished: true,
  completed: false,
  dismissed: false,
  completedAt: null,
  ...o,
})
const acao = async () => ({ ok: false, message: null, fields: {} })

test('mostra "4 de 7", lista só o que falta e o botão Continuar aponta para o primeiro', () => {
  render(<ChecklistComeco view={view()} dismissAction={acao} />)
  expect(screen.getByRole('heading', { name: 'Falta pouco para abrir sua agenda' })).toBeInTheDocument()
  expect(screen.getByRole('meter', { name: 'Progresso do começo' })).toHaveAttribute('aria-valuetext', '4 de 7')
  const itens = screen.getAllByRole('listitem').map((li) => li.textContent)
  expect(itens).toEqual(['ExpedientePulado', 'Equipe', 'Link para clientes'])
  expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/painel/comecar?passo=equipe')
  expect(screen.getByRole('link', { name: /Expediente/ })).toHaveAttribute('href', '/painel/comecar?passo=expediente')
  expect(screen.getByRole('button', { name: 'Dispensar o passo a passo' })).toBeInTheDocument()
})

test('concluído: "Tudo pronto" no lugar da lista', () => {
  render(<ChecklistComeco view={view({ done: 7, current: null, completed: true, completedAt: new Date() })} dismissAction={acao} />)
  expect(screen.getByRole('heading', { name: 'Tudo pronto' })).toBeInTheDocument()
  expect(screen.getByText('Sua loja já pode receber clientes.')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Continuar' })).toBeNull()
})

test('mostraChecklist: some dispensada, e a de "tudo pronto" some depois de um dia', () => {
  const agora = new Date('2026-11-20T12:00:00Z')
  expect(mostraChecklist(null, agora)).toBe(false)
  expect(mostraChecklist(view(), agora)).toBe(true)
  expect(mostraChecklist(view({ dismissed: true }), agora)).toBe(false)
  const pronto = (h: number) => view({ completed: true, completedAt: new Date(agora.getTime() - h * 3_600_000) })
  expect(mostraChecklist(pronto(2), agora)).toBe(true)
  expect(mostraChecklist(pronto(25), agora)).toBe(false)
})
