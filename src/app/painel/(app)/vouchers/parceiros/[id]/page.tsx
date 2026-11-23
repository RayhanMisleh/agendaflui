import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getPartner } from '@/server/domain/vouchers/partners'
import type { PartnerView } from '@/server/domain/vouchers/partners'
import { Card, LinkButton } from '@/ui/components'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../../PainelFrame'
import { ImagemUpload } from '../../../_lib/ImagemUpload'
import { MENSAGENS_DE_IMAGEM } from '../../../_lib/imagem'
import { requirePainelModule } from '../../../_lib/modulo'
import { ParceiroForm } from '../../ParceiroForm'

export const metadata: Metadata = { title: 'Parceiro | Agenda Flui' }

export default async function ParceiroPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('manage_vouchers')
  await requirePainelModule(ctx, 'vouchers')
  const { id } = await params
  const q = await searchParams
  let parceiro: PartnerView
  try {
    parceiro = await getPartner(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const aviso = porCodigo(MENSAGENS_DE_IMAGEM, um(q.imagem))
  return (
    <PainelFrame
      ctx={ctx}
      title={parceiro.name}
      actions={
        <LinkButton href="/vouchers?aba=parceiros" variant="ghost">
          Voltar para parceiros
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="parceiro-logo" className="af-profile">
          <h2 id="parceiro-logo" className="af-section__title">
            Logo
          </h2>
          {aviso ? (
            <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {aviso.texto}
            </p>
          ) : null}
          <ImagemUpload action={`/vouchers/parceiros/${parceiro.id}/logo`} rotulo={`Logo de ${parceiro.name}`} src={parceiro.logoUrl} dica="JPEG, PNG ou WebP, até 8 MB. O logo não é cortado." />
        </Card>
        <Card as="section" aria-labelledby="parceiro-dados" className="af-profile">
          <h2 id="parceiro-dados" className="af-section__title">
            Dados do parceiro
          </h2>
          <ParceiroForm
            parceiro={{ id: parceiro.id, name: parceiro.name, description: parceiro.description ?? '', address: parceiro.address ?? '', phone: parceiro.phone ?? '', website: parceiro.website ?? '', active: parceiro.active }}
          />
        </Card>
      </div>
    </PainelFrame>
  )
}
