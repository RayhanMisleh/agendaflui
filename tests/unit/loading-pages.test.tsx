// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { ShellSkeleton } from '@/ui/components'

const RAIZ = process.cwd()
const PAINEL = ['', 'agenda', 'clientes', 'clientes/[id]', 'equipe', 'equipe/[id]', 'servicos', 'relatorios', 'fidelidade', 'banners', 'loja', 'configuracoes'].map(
  (r) => `src/app/app/painel/${r}`,
)
const DEV = ['', 'contas', 'contas/[id]', 'auditoria', 'sistema', 'admins'].map((r) => `src/app/dev/(app)/${r}`)
const ROTAS_COM_DADOS = [...PAINEL, ...DEV].map((r) => r.replace(/\/$/, ''))

test.each(ROTAS_COM_DADOS)('%s tem loading.tsx com ShellSkeleton', async (rota) => {
  const arquivo = join(RAIZ, rota, 'loading.tsx')
  expect(existsSync(arquivo), `falta ${arquivo}`).toBe(true)
  expect(readFileSync(arquivo, 'utf8')).toContain('ShellSkeleton')
  const { default: Loading } = (await import(/* @vite-ignore */ arquivo)) as { default: () => React.JSX.Element }
  render(<Loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Carregando')
})

const CLIENTE = [
  '',
  'boas-vindas',
  'agendar',
  'agendar/feito/[id]',
  'horarios',
  'horarios/[id]',
  'horarios/[id]/remarcar',
  'pets',
  'pets/[petId]',
  'premios',
  'premios/extrato',
  'loja',
  'loja/produto/[id]',
  'loja/carrinho',
  'loja/finalizar',
  'loja/enderecos',
  'loja/pedidos',
  'loja/pedidos/[id]',
  'mais',
  'mais/excluir',
].map((r) => `src/app/app/[slug]/(area)/${r}`.replace(/\/$/, ''))

test.each(CLIENTE)('%s tem loading.tsx com ClienteSkeleton', async (rota) => {
  const arquivo = join(RAIZ, rota, 'loading.tsx')
  expect(existsSync(arquivo), `falta ${arquivo}`).toBe(true)
  expect(readFileSync(arquivo, 'utf8')).toContain('ClienteSkeleton')
  const { default: Loading } = (await import(/* @vite-ignore */ arquivo)) as { default: () => React.JSX.Element }
  render(<Loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Carregando')
})

test.each(['dashboard', 'list', 'detail', 'planner'] as const)('ShellSkeleton %s anuncia carregamento', (variant) => {
  render(<ShellSkeleton variant={variant} />)
  const estado = screen.getByRole('status')
  expect(estado).toHaveTextContent('Carregando')
  expect(estado).not.toHaveAttribute('aria-busy')
  expect(estado.querySelector('.af-sr')).toHaveTextContent('Carregando')
  // Só o miolo: a barra lateral, a barra do topo e o menu pertencem ao layout e nunca entram no esqueleto.
  expect(estado.querySelector('.af-shell__side, .af-shell__frame, .af-shell__nav, .af-shell__top')).toBeNull()
  expect(estado.closest('.af-shell')).toBeNull()
  expect(estado.querySelector('.af-shell__head')).not.toBeNull()
  expect(estado.querySelectorAll('.af-skel').length).toBeGreaterThan(2)
})

test('os layouts (app) desenham a moldura no tema da conta e no tema noite, em volta do esqueleto', () => {
  const painel = readFileSync(join(RAIZ, 'src/app/app/painel/layout.tsx'), 'utf8')
  expect(painel).toContain('getPublicBrandById')
  expect(painel).toContain('PainelShell')
  expect(readFileSync(join(RAIZ, 'src/app/dev/(app)/layout.tsx'), 'utf8')).toContain('DevShell')
})
