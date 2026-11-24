import { Card, Skeleton } from '@/ui/components'
import { SkeletonTransition } from '@/ui/shells'

/** Só o miolo: a moldura (topo e aviso) é do layout e fica no lugar. */
export default function Loading() {
  return (
    <SkeletonTransition>
      <main className="af-account__main" role="status">
        <span className="af-sr">Carregando</span>
        <h1 className="af-account__title">Minha conta</h1>
        {[3, 2, 3].map((linhas, i) => (
          <Card key={i} className="af-conta__card">
            <Skeleton lines={linhas} />
          </Card>
        ))}
      </main>
    </SkeletonTransition>
  )
}
