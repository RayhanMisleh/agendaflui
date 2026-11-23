import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { getBanner } from '@/server/domain/banners/banners'
import type { BannerView } from '@/server/domain/banners/banners'
import { DomainError } from '@/server/domain/errors'
import { Card, LinkButton } from '@/ui/components'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../PainelFrame'
import { ImagemUpload } from '../../_lib/ImagemUpload'
import { MENSAGENS_DE_IMAGEM } from '../../_lib/imagem'
import { requirePainelModule } from '../../_lib/modulo'
import { BannerForm } from '../BannerForm'

export const metadata: Metadata = { title: 'Banner | Agenda Flui' }

export default async function BannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('manage_banners')
  await requirePainelModule(ctx, 'banners')
  const { id } = await params
  const q = await searchParams
  let banner: BannerView
  try {
    banner = await getBanner(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const aviso = porCodigo(MENSAGENS_DE_IMAGEM, um(q.imagem))
  return (
    <PainelFrame
      ctx={ctx}
      title={banner.title}
      actions={
        <LinkButton href="/banners" variant="ghost">
          Voltar para banners
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="banner-imagem" className="af-profile">
          <h2 id="banner-imagem" className="af-section__title">
            Imagem
          </h2>
          {aviso ? (
            <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {aviso.texto}
            </p>
          ) : null}
          <ImagemUpload action={`/banners/${banner.id}/imagem`} rotulo={`Imagem de ${banner.title}`} src={banner.imageUrl} dica="JPEG, PNG ou WebP, até 8 MB, com pelo menos 400 pixels no lado menor. Use 16:9 (por exemplo 1920 x 1080); a imagem não é cortada." />
        </Card>
        <Card as="section" aria-labelledby="banner-dados" className="af-profile">
          <h2 id="banner-dados" className="af-section__title">
            Dados do banner
          </h2>
          <BannerForm
            banner={{ id: banner.id, title: banner.title, linkUrl: banner.linkUrl ?? '', startsOn: banner.startsOn ?? '', endsOn: banner.endsOn ?? '', active: banner.active, temImagem: banner.imageUrl !== null }}
          />
        </Card>
      </div>
    </PainelFrame>
  )
}
