// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { IntegracoesForms, type AcoesIntegracoes, type IntegracoesDados } from '@/app/dev/(app)/contas/[id]/integracoes/IntegracoesForms'

const acao = (async (prev) => prev) as AcoesIntegracoes['salvarFrenet']
const acoes: AcoesIntegracoes = { salvarMercadoPago: acao, removerMercadoPago: acao, salvarFrenet: acao, removerFrenet: acao }

const VAZIO: IntegracoesDados = {
  version: 0,
  mercadoPago: { configured: false, accessTokenLast4: null, webhookSecretLast4: null, webhookUrl: null, updatedLabel: null },
  frenet: { configured: false, tokenLast4: null, updatedLabel: null },
}
const CONFIGURADO: IntegracoesDados = {
  version: 3,
  mercadoPago: { configured: true, accessTokenLast4: 'Qz7K', webhookSecretLast4: 'Hy5N', webhookUrl: 'http://api.exemplo.test/v1/webhooks/mercadopago/chave123', updatedLabel: '17/11/2026 10:00' },
  frenet: { configured: true, tokenLast4: 'Vb6D', updatedLabel: '17/11/2026 10:05' },
}

test('sem configuração: situação em texto, sem remover e sem endereço do webhook', () => {
  render(<IntegracoesForms dados={VAZIO} acoes={acoes} />)
  expect(screen.getAllByText('Não configurado')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull()
  expect(screen.getByText(/aparece aqui depois de salvar/)).toBeInTheDocument()
})

test('configurado: mostra só os finais, endereço com botão de copiar e remover; campos de senha ficam vazios', () => {
  const { container } = render(<IntegracoesForms dados={CONFIGURADO} acoes={acoes} />)
  expect(screen.getAllByText('Configurado')).toHaveLength(2)
  expect(screen.getByText(/Token termina em Qz7K, assinatura termina em Hy5N/)).toBeInTheDocument()
  expect(screen.getByText(/Token termina em Vb6D/)).toBeInTheDocument()
  expect(screen.getByText('http://api.exemplo.test/v1/webhooks/mercadopago/chave123')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copiar o endereço do webhook' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remover o Mercado Pago' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remover a Frenet' })).toBeInTheDocument()
  const senhas = container.querySelectorAll('input[type="password"]')
  expect(senhas).toHaveLength(3)
  for (const campo of senhas) {
    expect((campo as HTMLInputElement).value).toBe('')
    expect(campo.getAttribute('autocomplete')).toBe('new-password')
  }
  expect(Array.from(container.querySelectorAll('input[name="version"]')).map((i) => (i as HTMLInputElement).value)).toEqual(['3', '3'])
})
