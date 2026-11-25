import { cx } from './cx'

/** Só os dígitos, com `+` e DDI: 10 ou 11 dígitos sem DDI são do Brasil. */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const international = phone.trim().startsWith('+') || digits.length > 11
  return `tel:+${international ? digits : `55${digits}`}`
}

/** Telefone que liga com um toque no celular. Sem número, diz que não há (nunca um link vazio). */
export function PhoneLink({ phone, label, className }: { phone: string | null | undefined; label?: string; className?: string }) {
  if (!phone || phone.replace(/\D/g, '') === '') return <span className={cx('af-phone af-phone--none', className)}>Sem telefone</span>
  return (
    <a className={cx('af-phone', className)} href={telHref(phone)}>
      {label ?? phone}
    </a>
  )
}
