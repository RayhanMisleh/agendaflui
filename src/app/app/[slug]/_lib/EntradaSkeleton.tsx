import { Skeleton } from '@/ui/components'

/** Esqueleto no desenho da tela de entrada da loja (faixa de destaque e cartão), enquanto a loja carrega. */
export function EntradaSkeleton() {
  return (
    <main className="af-entry">
      <section className="af-entry__hero" aria-hidden="true" />
      <div className="af-entry__panel">
        <section className="af-card af-entry__card">
          <Skeleton lines={4} />
        </section>
      </div>
    </main>
  )
}
