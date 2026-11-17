import type { ComponentProps } from 'react'
import { cx } from './cx'

export type InputProps = ComponentProps<'input'> & { invalid?: boolean }

/** Campo de texto: superfície, borda fina, 44 px de altura. */
export function Input({ invalid, className, ...rest }: InputProps) {
  return <input aria-invalid={invalid || undefined} {...rest} className={cx('af-input', className)} />
}
