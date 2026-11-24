import { Check } from 'lucide-react'
import { cx } from './cx'

/**
 * O momento de celebração (concluir o quiz, marcar um horário): o selo do visto cresce e oito bolhas sobem uma vez. Com
 * `prefers-reduced-motion: reduce` só o selo, parado. Decorativo: quem usa diz o que aconteceu em texto.
 */
export function Celebration({ play, className }: { play: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('af-cl-celebration', play && 'is-playing', className)}>
      <span className="af-cl-celebration__seal">
        <Check size={32} strokeWidth={3} />
      </span>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={cx('af-cl-celebration__bubble', `af-cl-celebration__bubble--${i + 1}`)} />
      ))}
    </span>
  )
}
