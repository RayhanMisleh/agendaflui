import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './cx'

export type SelectProps = ComponentProps<'select'> & { invalid?: boolean }

/** Lista de opções nativa (funciona sem JavaScript) com a seta da marca. */
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className="af-select">
      <select aria-invalid={invalid || undefined} {...rest} className={cx('af-input af-select__control', className)}>
        {children}
      </select>
      <ChevronDown className="af-select__chevron" size={18} aria-hidden="true" />
    </span>
  )
}
