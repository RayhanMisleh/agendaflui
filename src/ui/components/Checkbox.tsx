import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }

/** Caixa que se marca a caneta. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('af-checkbox', className)}>
      <input {...rest} type="checkbox" className="af-checkbox__input" />
      <span className="af-checkbox__box" aria-hidden="true" />
      <span className="af-checkbox__label">{label}</span>
    </label>
  )
}
