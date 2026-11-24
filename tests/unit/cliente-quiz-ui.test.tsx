// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuizPet } from '@/app/app/[slug]/boas-vindas/QuizPet'
import type { SalvarPetResultado } from '@/app/app/[slug]/boas-vindas/quiz'
import { ToastProvider } from '@/ui/components'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

type Salvar = (fd: FormData) => Promise<SalvarPetResultado>

function ver(o: { servesCats?: boolean; welcome?: boolean; salvar?: Salvar } = {}) {
  const salvar: Salvar = o.salvar ?? vi.fn(async () => ({ ok: true as const, petId: 'p1', next: '/loja-a/agendar?pet=p1' }))
  render(
    <ToastProvider>
      <QuizPet slug="loja-a" servesCats={o.servesCats ?? false} today="2026-11-25" firstName="Marina" welcome={o.welcome ?? false} back={null} salvar={salvar} />
    </ToastProvider>,
  )
  return { salvar, user: userEvent.setup() }
}

const continuar = () => screen.getByRole('button', { name: 'Continuar' })

async function ateOResumo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  await user.click(screen.getByRole('radio', { name: /Médio/ }))
  await user.click(continuar())
  for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: 'Pular' }))
}

beforeEach(() => router.push.mockReset())

test('uma pergunta por tela e a barra diz "1 de 8"', () => {
  ver()
  expect(screen.getByRole('heading', { name: 'Qual é o nome do seu pet?' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 de 8')
  expect(screen.queryByRole('heading', { name: 'Qual é o porte?' })).toBeNull()
})

test('voltar mostra o nome digitado antes', async () => {
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  expect(screen.getByRole('heading', { name: 'Qual é o porte?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Voltar' }))
  expect(screen.getByLabelText('Nome do pet')).toHaveValue('Thor')
})

test('Enter no nome avança e sem nome mostra o erro', async () => {
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), '{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('Escreva o nome do pet.')
  await user.type(screen.getByLabelText('Nome do pet'), 'Mel{Enter}')
  expect(screen.getByRole('heading', { name: 'Qual é o porte?' })).toBeInTheDocument()
})

test('porte: escolher Médio marca a opção e habilita Continuar', async () => {
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  expect(continuar()).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: /Médio/ }))
  expect(screen.getByRole('radio', { name: /Médio/ })).toBeChecked()
  expect(continuar()).toBeEnabled()
})

test('loja com gatos mostra a pergunta Cão ou gato?; sem gatos não mostra', async () => {
  const a = ver({ servesCats: true })
  await a.user.type(screen.getByLabelText('Nome do pet'), 'Mel')
  await a.user.click(continuar())
  expect(screen.getByRole('heading', { name: 'Cão ou gato?' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2 de 9')
  await a.user.click(screen.getByRole('radio', { name: 'Gato' }))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2 de 8')
  await a.user.click(continuar())
  expect(screen.getByRole('heading', { name: 'Qual é a raça?' })).toBeInTheDocument()
})

test('sem gatos não pergunta a espécie', async () => {
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  expect(screen.queryByRole('heading', { name: 'Cão ou gato?' })).toBeNull()
})

test('raça: lista com "Sem raça definida" primeiro, setas e Enter escolhem', async () => {
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor{Enter}')
  await user.click(screen.getByRole('radio', { name: /Pequeno/ }))
  await user.click(continuar())
  const campo = screen.getByRole('combobox', { name: 'Raça' })
  await user.type(campo, 'shi')
  const opcoes = within(screen.getByRole('listbox')).getAllByRole('option')
  expect(opcoes[0]).toHaveTextContent('Sem raça definida')
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(campo).toHaveValue('Shih-tzu')
  expect(screen.getByRole('heading', { name: 'Qual é a raça?' })).toBeInTheDocument()
})

test('resumo chama salvar com os campos, sobe a foto e "Mudar" leva ao passo', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, code: 'ok' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const { user, salvar } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  await user.click(screen.getByRole('radio', { name: /Médio/ }))
  await user.click(continuar())
  for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Pular' }))
  await user.upload(screen.getByLabelText('Foto do pet'), new File(['x'], 'thor.png', { type: 'image/png' }))
  await user.click(continuar())
  expect(screen.getByRole('heading', { name: 'Tudo certo?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mudar porte' }))
  expect(screen.getByRole('heading', { name: 'Qual é o porte?' })).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: /Grande/ }))
  await user.click(continuar())
  expect(screen.getByRole('heading', { name: 'Tudo certo?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Agendar agora' }))
  await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
  const fd = vi.mocked(salvar).mock.calls[0]?.[0] as FormData
  expect(Object.fromEntries(fd.entries())).toMatchObject({ name: 'Thor', species: 'DOG', size: 'LARGE', then: 'agendar', breed: '', birthMonth: '' })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/loja-a/pets/p1/foto', expect.objectContaining({ method: 'POST' })))
  await waitFor(() => expect(screen.getByText('Thor está pronto')).toBeInTheDocument())
  vi.unstubAllGlobals()
})

test('foto que falha avisa e o pet segue salvo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  await user.click(screen.getByRole('radio', { name: /Médio/ }))
  await user.click(continuar())
  for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Pular' }))
  await user.upload(screen.getByLabelText('Foto do pet'), new File(['x'], 'thor.png', { type: 'image/png' }))
  await user.click(continuar())
  await user.click(screen.getByRole('button', { name: 'Agendar agora' }))
  expect(await screen.findByText('Pet salvo. Não deu para enviar a foto; tente de novo em Meus pets.')).toBeInTheDocument()
  expect(screen.getByText('Thor está pronto')).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('foto recusada diz o motivo e o pet segue salvo', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'too_small' }), { status: 422 })))
  const { user } = ver()
  await user.type(screen.getByLabelText('Nome do pet'), 'Thor')
  await user.click(continuar())
  await user.click(screen.getByRole('radio', { name: /Médio/ }))
  await user.click(continuar())
  for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Pular' }))
  await user.upload(screen.getByLabelText('Foto do pet'), new File(['x'], 'thor.png', { type: 'image/png' }))
  await user.click(continuar())
  await user.click(screen.getByRole('button', { name: 'Agendar agora' }))
  expect(await screen.findByText('Pet salvo. A imagem é pequena demais. Escolha outra.')).toBeInTheDocument()
  expect(screen.getByText('Thor está pronto')).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('erro de salvar aparece em role=alert e as respostas ficam', async () => {
  const { user, salvar } = ver({ salvar: vi.fn(async () => ({ ok: false as const, message: 'Você já tem 20 pets ativos. Arquive algum antes.', fields: {} })) })
  await ateOResumo(user)
  await user.click(screen.getByRole('button', { name: 'Agendar agora' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Você já tem 20 pets ativos. Arquive algum antes.')
  expect(salvar).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Thor')).toBeInTheDocument()
  expect(router.push).not.toHaveBeenCalled()
})

test('boas-vindas: tela inicial com o nome e "Começar" abre a primeira pergunta', async () => {
  const { user } = ver({ welcome: true })
  expect(screen.getByRole('heading', { name: 'Boas-vindas, Marina' })).toBeInTheDocument()
  expect(screen.getByText('Conte sobre o seu pet. Leva um minuto.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Começar' }))
  expect(screen.getByRole('heading', { name: 'Qual é o nome do seu pet?' })).toBeInTheDocument()
})
