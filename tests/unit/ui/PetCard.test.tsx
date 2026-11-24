// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { PetView } from '@/server/domain/pets/pets'
import { PetCard } from '@/ui/components/PetCard'

const pet: PetView = {
  id: 'p1',
  customerId: 'c1',
  name: 'Thor',
  species: 'DOG',
  size: 'MEDIUM',
  variant: 'DOG_MEDIUM',
  typeLabel: 'Cão médio',
  rangeLabel: '10 a 25 kg',
  breed: 'Shih-tzu',
  birthMonth: '2023-05',
  ageLabel: '3 anos',
  coat: 'LONG',
  careNotes: 'Medo de secador',
  photoUrl: null,
  archived: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

test('mostra "Cão médio · 10 a 25 kg", raça, idade, pelagem e cuidados', () => {
  render(<PetCard pet={pet} href="/painel/clientes/c1/pets/p1" />)
  expect(screen.getByText('Cão médio · 10 a 25 kg')).toBeInTheDocument()
  expect(screen.getByText('Shih-tzu · 3 anos · Pelo longa')).toBeInTheDocument()
  expect(screen.getByText('Medo de secador')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Thor' })).toHaveAttribute('href', '/painel/clientes/c1/pets/p1')
  expect(screen.queryByText('Arquivado')).not.toBeInTheDocument()
})

test('arquivado leva o selo; gato mostra só "Gato"', () => {
  render(<PetCard pet={{ ...pet, species: 'CAT', size: null, variant: 'CAT', typeLabel: 'Gato', rangeLabel: null, archived: true }} />)
  expect(screen.getByText('Arquivado')).toBeInTheDocument()
  expect(screen.getByText('Gato')).toBeInTheDocument()
})
