'use client'
import type { ChangeEvent, ComponentProps } from 'react'
import { MASKS, MASK_ATTRS, type MaskKind } from '@/shared/masks'
import { Input } from './Input'

export type MaskedInputProps = Omit<ComponentProps<typeof Input>, 'type'> & { mask: MaskKind }

/**
 * Campo de texto que formata enquanto a pessoa digita (telefone, CPF/CNPJ ou CEP). Só interface: o servidor aceita o valor
 * com ou sem pontuação. Funciona controlado (`value`) e não controlado (`defaultValue`); o valor inicial também sai formatado.
 */
export function MaskedInput({ mask, onChange, value, defaultValue, ...rest }: MaskedInputProps) {
  const formatar = MASKS[mask]
  const atributos = MASK_ATTRS[mask]
  const aoMudar = (e: ChangeEvent<HTMLInputElement>) => {
    const formatado = formatar(e.target.value)
    if (formatado !== e.target.value) e.target.value = formatado
    onChange?.(e)
  }
  return (
    <Input
      type={mask === 'phone' ? 'tel' : 'text'}
      {...atributos}
      {...rest}
      {...(value !== undefined ? { value: formatar(String(value)) } : {})}
      {...(defaultValue !== undefined ? { defaultValue: formatar(String(defaultValue)) } : {})}
      onChange={aoMudar}
    />
  )
}
