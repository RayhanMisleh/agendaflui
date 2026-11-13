import type { ComponentProps } from 'react'
import { cx } from './cx'

export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean }

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return <textarea aria-invalid={invalid || undefined} {...rest} className={cx('af-input af-textarea', className)} />
}
