import { Avatar } from '@/ui/components'
import { pointsText } from '@/shared/terms'

export type LinhaDoRanking = { position: number; firstName: string; avatarUrl: string | null; points: number; isYou?: true }

/** Ranking do mês: lista curta com a posição, o primeiro nome e os pontos ganhos; a linha do cliente vem destacada. */
export function Ranking({ entries }: { entries: LinhaDoRanking[] }) {
  if (entries.length === 0) return null
  return (
    <section className="af-cl-ranking" aria-labelledby="ranking-titulo">
      <h2 id="ranking-titulo" className="af-cl-section">
        Ranking do mês
      </h2>
      <ol className="af-cl-ranking__list">
        {entries.map((e) => (
          <li key={e.position} className={e.isYou ? 'af-cl-ranking__row is-you' : 'af-cl-ranking__row'} {...(e.isYou ? { 'aria-label': `Você, ${e.position}º lugar` } : {})}>
            <span className="af-cl-ranking__pos">{e.position}º</span>
            <Avatar name={e.firstName} src={e.avatarUrl} size="sm" />
            <span className="af-cl-ranking__name">{e.isYou ? `${e.firstName} (você)` : e.firstName}</span>
            <span className="af-cl-ranking__points">{pointsText(e.points)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
