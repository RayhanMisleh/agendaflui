import { Card, Skeleton } from '@/ui/components'
import { AccountShell } from '@/ui/shells'

export default function Loading() {
  return (
    <AccountShell title="Minha conta" back={null}>
      {[3, 2, 3].map((linhas, i) => (
        <Card key={i} className="af-conta__card">
          <Skeleton lines={linhas} />
        </Card>
      ))}
    </AccountShell>
  )
}
