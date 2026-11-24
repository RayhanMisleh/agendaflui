// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PetTypePicker } from '@/ui/components/PetTypePicker'
import type { PetTypeValue } from '@/ui/components/PetTypePicker'

function Caixa({ servesCats, staffMayPickCat, inicial = { species: 'DOG', size: null } }: { servesCats: boolean; staffMayPickCat: boolean; inicial?: PetTypeValue }) {
  const [v, setV] = useState<PetTypeValue>(inicial)
  return (
    <form>
      <PetTypePicker servesCats={servesCats} staffMayPickCat={staffMayPickCat} value={v} onChange={setV} />
    </form>
  )
}

const campo = (nome: string) => document.querySelector<HTMLInputElement>(`form [name="${nome}"]`)

test('sem servesCats e sem staffMayPickCat não mostra Gato', () => {
  render(<Caixa servesCats={false} staffMayPickCat={false} />)
  expect(screen.queryByRole('radio', { name: 'Gato' })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Cão' })).toBeInTheDocument()
})

test('gatos desligados com equipe: Gato aparece e a ajuda avisa que só a equipe marca', () => {
  render(<Caixa servesCats={false} staffMayPickCat />)
  expect(screen.getByRole('radio', { name: 'Gato' })).toBeInTheDocument()
  expect(screen.getByText('A loja não atende gatos no momento. Só a equipe marca para gatos.')).toBeInTheDocument()
})

test('escolher Gato esconde os portes e limpa size', async () => {
  render(<Caixa servesCats staffMayPickCat={false} inicial={{ species: 'DOG', size: 'LARGE' }} />)
  expect(campo('size')?.value).toBe('LARGE')
  await userEvent.click(screen.getByRole('radio', { name: 'Gato' }))
  expect(screen.queryByRole('radiogroup', { name: /Porte/ })).not.toBeInTheDocument()
  expect(campo('species')?.value).toBe('CAT')
  expect(campo('size')).toBeNull()
})

test('mostra "Médio" e "10 a 25 kg" e marca aria-checked no escolhido', async () => {
  render(<Caixa servesCats staffMayPickCat={false} />)
  const medio = screen.getByRole('radio', { name: /Médio/ })
  expect(medio).toHaveTextContent('10 a 25 kg')
  expect(medio).toHaveAttribute('aria-checked', 'false')
  await userEvent.click(medio)
  expect(medio).toHaveAttribute('aria-checked', 'true')
  expect(campo('size')?.value).toBe('MEDIUM')
  expect(screen.getByRole('radio', { name: /Pequeno/ })).toHaveAttribute('aria-checked', 'false')
})

test('setas movem a seleção entre os portes', async () => {
  render(<Caixa servesCats staffMayPickCat={false} inicial={{ species: 'DOG', size: 'SMALL' }} />)
  screen.getByRole('radio', { name: /Pequeno/ }).focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: /Médio/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: /Médio/ })).toHaveFocus()
})
