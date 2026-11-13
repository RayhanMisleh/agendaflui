import { cx } from './cx'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toLocaleUpperCase('pt-BR')
}

/** Foto em moldura redonda; sem foto, as iniciais gravadas. */
export function Avatar({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span role="img" aria-label={name} className={cx('af-avatar', `af-avatar--${size}`, className)}>
      <span className="af-avatar__initials af-engraved" aria-hidden="true">
        {initials(name)}
      </span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a foto vem do armazenamento da conta; sem otimização aqui
        <img src={src} alt="" className="af-avatar__photo" />
      ) : null}
    </span>
  )
}
