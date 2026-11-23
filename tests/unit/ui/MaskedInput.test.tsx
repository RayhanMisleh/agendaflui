// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MaskedInput } from '@/ui/components'

function Controlado() {
  const [v, setV] = useState('')
  return <MaskedInput mask="phone" aria-label="Telefone" name="phone" value={v} onChange={(e) => setV(e.target.value)} />
}

test('controlado: formata enquanto digita e o estado guarda o valor formatado', () => {
  render(<Controlado />)
  const campo = screen.getByLabelText('Telefone') as HTMLInputElement
  fireEvent.change(campo, { target: { value: '11912345678' } })
  expect(campo.value).toBe('(11) 91234-5678')
  fireEvent.change(campo, { target: { value: '+49 151 1234 5678' } })
  expect(campo.value).toBe('+49 151 1234 5678')
})

test('não controlado: o valor inicial já sai formatado e a digitação segue a máscara', () => {
  render(<MaskedInput mask="document" aria-label="Documento" name="document" defaultValue="11222333000181" />)
  const campo = screen.getByLabelText('Documento') as HTMLInputElement
  expect(campo.value).toBe('11.222.333/0001-81')
  fireEvent.change(campo, { target: { value: '12abc34501de35' } })
  expect(campo.value).toBe('12.ABC.345/01DE-35')
})

test('atributos de acessibilidade por máscara', () => {
  render(
    <>
      <MaskedInput mask="phone" aria-label="Telefone" />
      <MaskedInput mask="document" aria-label="Documento" />
      <MaskedInput mask="cep" aria-label="CEP" />
    </>,
  )
  const tel = screen.getByLabelText('Telefone')
  expect([tel.getAttribute('type'), tel.getAttribute('inputmode'), tel.getAttribute('autocomplete')]).toEqual(['tel', 'tel', 'tel'])
  const doc = screen.getByLabelText('Documento')
  expect([doc.getAttribute('inputmode'), doc.getAttribute('maxlength')]).toEqual(['text', '18'])
  const cep = screen.getByLabelText('CEP')
  expect([cep.getAttribute('inputmode'), cep.getAttribute('autocomplete'), cep.getAttribute('maxlength')]).toEqual(['numeric', 'postal-code', '9'])
})
