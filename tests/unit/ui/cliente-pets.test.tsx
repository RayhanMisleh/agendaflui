// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { ListaDePets } from '@/app/app/[slug]/(area)/pets/_lib/ListaDePets'
import type { PetView } from '@/server/domain/pets/pets'
import { ToastProvider } from '@/ui/components'

vi.mock('@/app/app/[slug]/(area)/pets/actions', () => ({ editarPet: vi.fn(), arquivarPet: vi.fn(), restaurarPet: vi.fn() }))

function pet(o: Partial<PetView>): PetView {
  return {
    id: 'p1',
    customerId: 'c1',
    name: 'Thor',
    species: 'DOG',
    size: 'MEDIUM',
    variant: 'DOG_MEDIUM',
    typeLabel: 'Cão médio',
    rangeLabel: '10 a 25 kg',
    breed: null,
    birthMonth: null,
    ageLabel: null,
    coat: null,
    careNotes: null,
    photoUrl: null,
    archived: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...o,
  }
}

const ver = (p: Parameters<typeof ListaDePets>[0]) =>
  render(
    <ToastProvider>
      <ListaDePets {...p} />
    </ToastProvider>,
  )

test('gato com gatos desligados mostra "A loja não atende gatos no momento" e sem botão Agendar', () => {
  ver({ slug: 'a', servesCats: false, pets: [pet({ id: 'g1', name: 'Mel', species: 'CAT', size: null, variant: 'CAT', typeLabel: 'Gato', rangeLabel: null }), pet({})], archived: [], showArchived: false })
  expect(screen.getByText('A loja não atende gatos no momento')).toBeInTheDocument()
  // só o Thor tem o atalho
  expect(screen.getAllByRole('link', { name: 'Agendar' })).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Agendar' })).toHaveAttribute('href', '/a/agendar?pet=p1')
})

test('com gatos ligados o gato agenda normalmente', () => {
  ver({ slug: 'a', servesCats: true, pets: [pet({ id: 'g1', name: 'Mel', species: 'CAT', size: null, variant: 'CAT', typeLabel: 'Gato', rangeLabel: null })], archived: [], showArchived: false })
  expect(screen.queryByText('A loja não atende gatos no momento')).toBeNull()
  expect(screen.getByRole('link', { name: 'Agendar' })).toBeInTheDocument()
})

test('vazio mostra "Nenhum pet ainda" e "Adicionar pet"', () => {
  ver({ slug: 'a', servesCats: false, pets: [], archived: [], showArchived: false })
  expect(screen.getByRole('heading', { name: 'Nenhum pet ainda' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Adicionar pet' })).toHaveAttribute('href', '/a/boas-vindas?novo=1')
})

test('arquivados: link com a contagem e, aberto, "Restaurar" em cada um', () => {
  const arquivado = pet({ id: 'p2', name: 'Bidu', archived: true })
  const { unmount } = ver({ slug: 'a', servesCats: false, pets: [pet({})], archived: [arquivado], showArchived: false })
  expect(screen.getByRole('link', { name: 'Ver arquivados (1)' })).toHaveAttribute('href', '/a/pets?arquivados=1')
  expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull()
  unmount()
  ver({ slug: 'a', servesCats: false, pets: [pet({})], archived: [arquivado], showArchived: true })
  expect(screen.getByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
})
