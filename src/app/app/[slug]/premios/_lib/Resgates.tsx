'use client'
import { useToast } from '@/ui/components'
import { pointsText } from '@/shared/terms'
import { ClienteForm } from '../../_lib/ClienteForm'
import { cancelarResgate } from '../actions'

export type ResgatePendente = { id: string; prizeName: string; costPoints: number; createdLabel: string }

/** Os resgates que esperam a retirada no balcão, cada um com "Cancelar resgate" (os pontos voltam). */
export function Resgates({ slug, resgates }: { slug: string; resgates: ResgatePendente[] }) {
  const toast = useToast()
  if (resgates.length === 0) return null
  return (
    <section className="af-cl-redemptions" aria-labelledby="resgates-titulo">
      <h2 id="resgates-titulo" className="af-cl-section">
        Seus resgates
      </h2>
      <ul className="af-cl-redemptions__list">
        {resgates.map((r) => (
          <li key={r.id} className="af-cl-redemption">
            <div className="af-cl-redemption__main">
              <p className="af-cl-redemption__name">{r.prizeName}</p>
              <p className="af-cl-redemption__meta">
                {pointsText(r.costPoints)} · pedido em {r.createdLabel}
              </p>
              <p className="af-cl-redemption__hint">Retire no balcão.</p>
            </div>
            <ClienteForm
              action={cancelarResgate}
              slug={slug}
              hidden={{ id: r.id }}
              submit="Cancelar resgate"
              variant="ghost"
              size="sm"
              onDone={(estado) => toast({ tone: 'success', message: estado.message ?? 'Resgate cancelado.' })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
