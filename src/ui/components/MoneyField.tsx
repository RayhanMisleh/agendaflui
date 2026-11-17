'use client'
import { useState } from 'react'
import { formatMoneyInput, parseMoney } from '@/ui/money'
import { Input } from './Input'
import type { InputProps } from './Input'

/**
 * Campo de dinheiro em reais. Aceita vírgula ou ponto ("35,90", "35.90") e recusa texto. Ao sair do campo, arruma o
 * valor para "35,90". O formulário leva só o texto digitado em `name`; quem lê (a ação de servidor) converte em centavos
 * com `parseMoney`, a mesma função daqui.
 */
export function MoneyField({
  name,
  defaultValue = '',
  invalid,
  ...rest
}: Omit<InputProps, 'type' | 'name' | 'defaultValue' | 'value' | 'inputMode'> & {
  name: string
  defaultValue?: string
}) {
  const [texto, setTexto] = useState(defaultValue)
  const cents = texto.trim() === '' ? null : parseMoney(texto)
  const recusado = texto.trim() !== '' && cents === null
  return (
    <>
      <Input
        {...rest}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        invalid={invalid || recusado}
        placeholder={rest.placeholder ?? '0,00'}
        onChange={(e) => {
          setTexto(e.target.value)
        }}
        onBlur={(e) => {
          const c = parseMoney(e.target.value)
          if (c !== null) setTexto(formatMoneyInput(c))
          rest.onBlur?.(e)
        }}
        className="af-moneyfield"
      />
      {recusado ? (
        <span className="af-sr" role="status">
          Digite um valor em reais, por exemplo 35,90.
        </span>
      ) : null}
    </>
  )
}
