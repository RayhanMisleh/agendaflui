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
  expect(secoes).toHaveLength(7)
  for (const s of secoes) expect(s.hasAttribute('hidden')).toBe(false)
  for (const nome of ['name', 'slug', 'primary', 'material', 'club', 'bufferMin', 'ownerEmail', 'keyName']) {
    expect(doc.querySelector(`form [name="${nome}"]`), nome).not.toBeNull()
  }
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
  await userEvent.click(within(trilho).getByRole('link', { name: /Termos/ }))
  expect(screen.getByRole('heading', { name: 'Termos' })).toBeVisible()
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

test('o termo escolhido aparece na prévia e as sugestões por ramo só mexem nos termos', async () => {
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.click(screen.getByRole('link', { name: /Termos/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Pet shop' }))
  expect(screen.getByLabelText('Profissional (singular)')).toHaveValue('Tosador')
  expect(within(screen.getByTestId('brand-preview-mock')).getAllByText(/Tosador/).length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole('link', { name: /Dados/ }))
  expect(screen.getByLabelText('Nome da conta')).toHaveValue('')
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
  await userEvent.click(screen.getByRole('link', { name: /Chave de app/ }))
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

test('depois de criar, mostra o segredo da chave uma vez, com aviso e botão de copiar', async () => {
  acao.criarConta.mockImplementation(async (): Promise<FormState<WizardData>> => ({
    ok: true,
    message: null,
    fields: {},
    values: {
      ...EMPTY_VALUES,
      result: {
        createdId: 'c-1',
        businessName: 'Pata Viva',
        entryUrl: 'http://painel.exemplo.test/entrar/pata-viva',
        ownerEmail: 'marina@exemplo.test',
        ownerExisting: false,
        emailSent: true,
        pendencias: [],
        keyName: 'App Pata Viva',
        secret: 'afk_a_1234abcd_SEGREDO',
      },
    },
  }))
  render(<Wizard initial={inicial} grades={SLOT_STEPS} limites={RULE_LIMITS} />)
  await userEvent.click(screen.getByRole('link', { name: /Chave de app/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  expect(await screen.findByRole('heading', { name: 'Pata Viva está criada' })).toHaveFocus()
  expect(screen.getByText('afk_a_1234abcd_SEGREDO')).toBeInTheDocument()
  expect(screen.getByText('Copie a chave de app agora. Ela não será mostrada de novo.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copiar a chave App Pata Viva' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Abrir a conta' })).toHaveAttribute('href', '/contas/c-1')
  expect(screen.getByText(/Enviamos para marina@exemplo.test o convite/)).toBeInTheDocument()
})
