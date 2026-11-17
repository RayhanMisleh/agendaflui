import type { ComponentProps, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }

/** Caixa de 20 px, marcada em `brand`. O rótulo também é clicável. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('af-checkbox', className)}>
      <input {...rest} type="checkbox" className="af-checkbox__input" />
      <span className="af-checkbox__box" aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      <span className="af-checkbox__label">{label}</span>
    </label>
  )
}
