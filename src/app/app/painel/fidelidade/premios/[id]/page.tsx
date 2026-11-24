import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getPrize } from '@/server/domain/loyalty/prizes'
import type { PrizeView } from '@/server/domain/loyalty/prizes'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../../PainelFrame'
import { ImagemUpload } from '../../../_lib/ImagemUpload'
import { MENSAGENS_DE_IMAGEM } from '../../../_lib/imagem'
import { requirePainelModule } from '../../../_lib/modulo'
import { PremioForm } from '../../FidelidadePainel'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Prêmio | Agenda Flui' }

export default async function PremioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('manage_loyalty')
  await requirePainelModule(ctx, 'loyalty')
  const { id } = await params
  const q = await searchParams
  let premio: PrizeView
  try {
    premio = await getPrize(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  await getPainelContext(ctx)
  const terms = TERMS
  const aviso = porCodigo(MENSAGENS_DE_IMAGEM, um(q.imagem))
  return (
    <PainelFrame
      ctx={ctx}
      title={premio.name}
      actions={
        <LinkButton href="/painel/fidelidade" variant="ghost">
          Voltar para a fidelidade
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="premio-imagem" className="af-profile">
          <h2 id="premio-imagem" className="af-section__title">
            Imagem
          </h2>
          {aviso ? (
            <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {aviso.texto}
            </p>
          ) : null}
          <ImagemUpload action={`/painel/fidelidade/premios/${premio.id}/imagem`} rotulo={`Imagem de ${premio.name}`} src={premio.imageUrl} dica="JPEG, PNG ou WebP, até 8 MB. A imagem não é cortada." />
        </Card>
        <Card as="section" aria-labelledby="premio-dados" className="af-profile">
          <h2 id="premio-dados" className="af-section__title">
            Dados do prêmio
          </h2>
          <PremioForm
            premio={{ id: premio.id, name: premio.name, description: premio.description ?? '', costPoints: premio.costPoints, stock: premio.stock, active: premio.active }}
            termos={{ ponto: terms.pointsSingular, pontos: terms.pointsPlural, clube: terms.club, cliente: terms.customerPlural }}
          />
        </Card>
      </div>
    </PainelFrame>
  )
}
