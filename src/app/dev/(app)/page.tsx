import type { Metadata } from 'next'
import { BookOpen } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { listBusinesses } from '@/server/domain/platform/businesses'
import { LinkButton } from '@/ui/components'
import { ContasLista } from './ContasLista'
import { DevFrame } from './DevFrame'

export const metadata: Metadata = { title: 'Visão geral | AgendaFlui' }

export default async function VisaoGeralPage() {
  const admin = await requirePlatformAdmin()
  const { items } = await listBusinesses(admin, { limit: 100 })
  const contas = items.map((c) => ({ id: c.id, name: c.name, slug: c.slug, status: c.status, entrada: c.entryUrl }))
  return (
    <DevFrame admin={admin} title="Visão geral">
      <div className="af-home">
        <h2 className="af-home__hello af-home__hello--dev">Contas</h2>
        <p className="af-home__meta af-home__meta--dev">
          Cada conta entra pelo próprio link, já com a marca dela. Copie o link e envie a quem vai usar.
        </p>
        <ContasLista contas={contas} />
        <p className="af-home__row">
          <LinkButton href="/vitrine" icon={<BookOpen size={18} />}>
            Vitrine de componentes
          </LinkButton>
        </p>
      </div>
    </DevFrame>
  )
}
