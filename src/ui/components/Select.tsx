import type { ComponentProps } from 'react'
import { cx } from './cx'

export type SelectProps = ComponentProps<'select'> & { invalid?: boolean }

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select aria-invalid={invalid || undefined} {...rest} className={cx('af-input af-select', className)}>
      {children}
    </select>
  )
}
