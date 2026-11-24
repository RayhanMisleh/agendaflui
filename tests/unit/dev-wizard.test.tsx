// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_VALUES } from '@/app/dev/(app)/contas/nova/fields'
import type { WizardData } from '@/app/dev/(app)/contas/nova/fields'
import type { FormState } from '@/app/_lib/form-state'

const acao = vi.hoisted(() => ({ criarConta: vi.fn() }))
vi.mock('@/app/dev/(app)/contas/nova/actions', () => acao)

import { Wizard } from '@/app/dev/(app)/contas/nova/Wizard'
import { RULE_LIMITS, SLOT_STEPS } from '@/server/domain/settings/scheduling-rules'

const inicial: FormState<WizardData> = { ok: false, message: null, fields: {}, values: EMPTY_VALUES }

beforeEach(() => {
  acao.criarConta.mockReset()
})

test('sem JavaScript todas as etapas aparecem num formulário só, com os campos nomeados e o botão de criar', () => {
  const html = renderToString(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const secoes = doc.querySelectorAll('section.af-wizard__step')
  expect(secoes).toHaveLength(6)
  for (const s of secoes) expect(s.hasAttribute('hidden')).toBe(false)
  for (const nome of ['name', 'slug', 'primary', 'material', 'niche', 'servesCats', 'bufferMin', 'ownerEmail']) {
    expect(doc.querySelector(`form [name="${nome}"]`), nome).not.toBeNull()
  }
  expect(doc.querySelector('form [name="keyName"]')).toBeNull()
  expect(doc.querySelector('form [name="createKey"]')).toBeNull()
  expect(doc.querySelector('button[type="submit"]')?.textContent).toContain('Criar conta')
  expect(doc.querySelector('nav[aria-label="Etapas da criação da conta"] a[href="#etapa-dono"]')).not.toBeNull()
})

test('com JavaScript mostra uma etapa por vez; Continuar e o trilho trocam a etapa e marcam aria-current', async () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  const trilho = screen.getByRole('navigation', { name: 'Etapas da criação da conta' })
  expect(within(trilho).getByRole('link', { name: /Dados/ })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByRole('heading', { name: 'Marca', hidden: true })).not.toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(within(trilho).getByRole('link', { name: /Marca/ })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByRole('heading', { name: 'Marca' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Marca' })).toHaveFocus()
  await userEvent.click(within(trilho).getByRole('link', { name: /Módulos/ }))
  expect(screen.getByRole('heading', { name: 'Módulos' })).toBeVisible()
  // O que foi digitado numa etapa continua no formulário quando a etapa fica escondida.
  expect(document.querySelector('form [name="slug"]')).toBeInTheDocument()
})

test('o nome sugere o identificador e o nome de exibição; mexer neles à mão para a sugestão', async () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.type(screen.getByLabelText('Nome da conta'), 'Pata Viva Pet Shop')
  expect(screen.getByLabelText('Identificador')).toHaveValue('pata-viva-pet-shop')
  await userEvent.clear(screen.getByLabelText('Identificador'))
  await userEvent.type(screen.getByLabelText('Identificador'), 'patas')
  await userEvent.type(screen.getByLabelText('Nome da conta'), ' 2')
  expect(screen.getByLabelText('Identificador')).toHaveValue('patas')
})

test('Enter num campo de etapa do meio avança em vez de enviar o formulário', async () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.type(screen.getByLabelText('Nome da conta'), 'Pata{Enter}')
  expect(acao.criarConta).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Marca' })).toBeVisible()
})

test('não há etapa de termos: os termos são fixos para todas as contas', () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  const trilho = screen.getByRole('navigation', { name: 'Etapas da criação da conta' })
  expect(within(trilho).queryByRole('link', { name: /Termos/ })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Profissional (singular)')).not.toBeInTheDocument()
})

test('passo Nicho: o cartão Pet shop está marcado e clicar não desmarca; o switch "Atende gatos" muda o valor enviado', async () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  const trilho = screen.getByRole('navigation', { name: 'Etapas da criação da conta' })
  await userEvent.click(within(trilho).getByRole('link', { name: /Nicho/ }))
  expect(screen.getByRole('heading', { name: 'Nicho' })).toBeVisible()
  const grupo = screen.getByRole('radiogroup', { name: 'Nicho da conta' })
  const cartao = within(grupo).getByRole('radio', { name: /Pet shop/ })
  expect(cartao).toHaveAttribute('aria-checked', 'true')
  expect(cartao).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(cartao)
  await userEvent.keyboard(' ')
  expect(cartao).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('Selecionado')).toBeVisible()
  const chave = screen.getByRole('switch', { name: 'Atende gatos' })
  expect(chave).toHaveAttribute('aria-checked', 'false')
  expect(document.querySelector('form [name="servesCats"]')).toBeNull()
  await userEvent.click(chave)
  expect(chave).toHaveAttribute('aria-checked', 'true')
  expect((document.querySelector('form [name="servesCats"]') as HTMLInputElement).value).toBe('on')
})

test('erro do servidor leva à etapa do primeiro campo com erro, mantém os valores e liga a mensagem ao campo', async () => {
  acao.criarConta.mockImplementation(async (_prev: unknown, fd: FormData): Promise<FormState<WizardData>> => ({
    ok: false,
    message: 'Confira os campos marcados.',
    fields: { slug: 'Já existe uma conta com este identificador. Escolha outro.', ownerEmail: 'Informe um e-mail válido.' },
    values: { ...EMPTY_VALUES, name: String(fd.get('name')), slug: String(fd.get('slug')) },
  }))
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.type(screen.getByLabelText('Nome da conta'), 'Pata Viva')
  await userEvent.click(screen.getByRole('link', { name: /Dono/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  const trilho = screen.getByRole('navigation', { name: 'Etapas da criação da conta' })
  expect(await within(trilho).findByRole('link', { name: /Dados.*com erro/ })).toHaveAttribute('aria-current', 'step')
  expect(within(trilho).getByRole('link', { name: /Dono.*com erro/ })).toBeInTheDocument()
  const campo = screen.getByLabelText('Identificador')
  expect(campo).toHaveAttribute('aria-invalid', 'true')
  expect(campo).toHaveAccessibleDescription(/Já existe uma conta/)
  expect(screen.getByLabelText('Nome da conta')).toHaveValue('Pata Viva')
  expect(screen.getByRole('alert')).toHaveTextContent('Identificador: Já existe uma conta')
})

test('depois de criar, mostra a conta criada e o convite do dono, sem chave e sem link de entrada', async () => {
  acao.criarConta.mockImplementation(async (): Promise<FormState<WizardData>> => ({
    ok: true,
    message: null,
    fields: {},
    values: {
      ...EMPTY_VALUES,
      result: {
        createdId: 'c-1',
        businessName: 'Pata Viva',
        ownerEmail: 'marina@exemplo.test',
        ownerExisting: false,
        emailSent: true,
        customerLinkUrl: 'https://app.agendaflui.com.br/pata-viva',
        pendencias: [],
      },
    },
  }))
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.click(screen.getByRole('link', { name: /Dono/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  expect(await screen.findByRole('heading', { name: 'Pata Viva está criada' })).toHaveFocus()
  expect(screen.queryByRole('button', { name: /link de entrada/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/chave de app/i)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Abrir a conta' })).toHaveAttribute('href', '/contas/c-1')
  expect(screen.getByText(/Enviamos para marina@exemplo.test o convite/)).toBeInTheDocument()
  expect(screen.getByText('Link para clientes')).toBeInTheDocument()
  expect(screen.getByDisplayValue('https://app.agendaflui.com.br/pata-viva')).toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: 'Copiar o link para clientes' })).toBeInTheDocument()
})
