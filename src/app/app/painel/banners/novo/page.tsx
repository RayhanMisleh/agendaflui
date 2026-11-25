import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { Card, LinkButton } from '@/ui/components'
import { ShellPage } from '@/ui/shells'
import { requirePainelModule } from '../../_lib/modulo'
import { BannerForm } from '../BannerForm'

export const metadata: Metadata = { title: 'Novo banner | Agenda Flui' }

export default async function NovoBannerPage() {
  const ctx = await requireTenant('manage_banners')
  await requirePainelModule(ctx, 'banners')
  return (
    <ShellPage
      title="Novo banner"
      actions={
        <LinkButton href="/painel/banners" variant="ghost">
          Voltar para banners
        </LinkButton>
      }
    >
      <Card as="section" aria-labelledby="banner-novo" className="af-profile af-profile--narrow">
        <h2 id="banner-novo" className="af-section__title">
          Dados do banner
        </h2>
        <p className="af-section__help">Depois de criar, você envia a imagem e ativa o banner.</p>
        <BannerForm banner={null} />
      </Card>
    </ShellPage>
  )
}
