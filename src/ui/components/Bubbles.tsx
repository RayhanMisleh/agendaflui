import { cx } from './cx'

/**
 * Grafismo da marca (a espuma do banho): de dois a quatro círculos nas bordas do contêiner, recortados pelo raio dele.
 * Decorativo e escondido do leitor de tela; nunca fica atrás de texto corrido. O pai precisa ser `position: relative`
 * (o `Card` `block` já é). `on` diz sobre que fundo as bolhas estão, para escolher as cores.
 */
export function Bubbles({ count = 3, on = 'brand', className }: { count?: 2 | 3 | 4; on?: 'brand' | 'surface'; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('af-bubbles', `af-bubbles--on-${on}`, className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cx('af-bubble', `af-bubble--${i + 1}`)} />
      ))}
    </span>
  )
}
