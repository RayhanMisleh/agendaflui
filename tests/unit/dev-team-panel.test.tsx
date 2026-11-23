// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { TeamPanel } from '@/app/dev/(app)/contas/[id]/TeamPanel'
import type { Membro } from '@/app/dev/(app)/contas/[id]/TeamPanel'

const acao = async () => ({ ok: false, message: null, fields: {}, values: {} })
const acoes = { trocarPapel: acao, alternarAcesso: acao, reenviarConvite: acao, convidarMembro: acao }
const base: Membro = { membershipId: 'm1', name: 'Eva Dias', email: 'eva@exemplo.test', role: 'PROFESSIONAL', active: true, hasPassword: false, inviteMailFailed: false, lastLogin: null }

test('convite pendente com o e-mail enviado mostra "Convite pendente"', () => {
  render(<TeamPanel acoes={acoes} membros={[base]} />)
  expect(screen.getAllByText('Convite pendente').length).toBeGreaterThan(0)
  expect(screen.queryByText('Convite não enviado')).toBeNull()
})

test('convite cujo e-mail não saiu mostra "Convite não enviado" na linha, com o botão de reenviar', () => {
  render(<TeamPanel acoes={acoes} membros={[{ ...base, inviteMailFailed: true }]} />)
  expect(screen.getAllByText('Convite não enviado').length).toBeGreaterThan(0)
  expect(screen.queryByText('Convite pendente')).toBeNull()
  expect(screen.getAllByRole('button', { name: /Reenviar o convite de Eva Dias/ }).length).toBeGreaterThan(0)
})

test('quem já tem senha não mostra situação de convite', () => {
  render(<TeamPanel acoes={acoes} membros={[{ ...base, hasPassword: true, inviteMailFailed: true }]} />)
  expect(screen.queryByText('Convite não enviado')).toBeNull()
})
