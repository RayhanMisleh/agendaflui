import { cx } from '../components/cx'

/** A marca da conta: a logo em baixo-relevo ou, sem logo, o nome gravado. */
export function BrandMark(p: { name: string; logoUrl: string | null; size: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx('af-brand', `af-brand--${p.size}`)}>
      {p.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a logo vem do armazenamento da conta; sem otimização aqui
        <img src={p.logoUrl} alt={p.name} className="af-brand__logo" />
      ) : (
        <span className="af-brand__name af-engraved">{p.name}</span>
      )}
    </span>
  )
}
