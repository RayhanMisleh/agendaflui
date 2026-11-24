import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listBanners } from '@/server/domain/banners/banners'
import { Card } from '@/ui/components'
import { ShellPage } from '@/ui/shells'
import { requirePainelModule } from '../_lib/modulo'
import { BannersPainel } from './BannersPainel'
import type { BannerLinha } from './BannersPainel'

export const metadata: Metadata = { title: 'Banners | Agenda Flui' }

export default async function BannersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await searchParams
  const ctx = await requireTenant('manage_banners')
  await requirePainelModule(ctx, 'banners')
  const todos = await listBanners(ctx)
  const banners: BannerLinha[] = todos.map((b, i) => ({
    id: b.id,
    title: b.title,
    imageUrl: b.imageUrl,
    startsOn: b.startsOn,
    endsOn: b.endsOn,
    active: b.active,
    status: b.status,
    first: i === 0,
    last: i === todos.length - 1,
  }))
  return (
    <ShellPage title="Banners">
      <Card className="af-listpanel" as="section" aria-label="Banners">
        <BannersPainel banners={banners} />
      </Card>
    </ShellPage>
  )
}
