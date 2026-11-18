import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listPartners } from '@/server/domain/vouchers/partners'
import { getVoucher } from '@/server/domain/vouchers/vouchers'
import type { VoucherView } from '@/server/domain/vouchers/vouchers'
import { Card, LinkButton } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../PainelFrame'
import { ImagemUpload } from '../../_lib/ImagemUpload'
import { MENSAGENS_DE_IMAGEM } from '../../_lib/imagem'
import { requirePainelModule } from '../../_lib/modulo'
import { VoucherForm } from '../VoucherForm'

export const metadata: Metadata = { title: 'Voucher | AgendaFlui' }

export default async function VoucherPage({
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
  let voucher: VoucherView
  try {
    voucher = await getVoucher(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  // O parceiro atual continua como opção mesmo se foi parado ou arquivado, senão salvar o formulário o trocaria sem aviso.
  const parceiros = (await listPartners(ctx)).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))
  if (!parceiros.some((p) => p.id === voucher.partnerId)) parceiros.push({ id: voucher.partnerId, name: voucher.partnerName })
  const aviso = porCodigo(MENSAGENS_DE_IMAGEM, um(q.imagem))
  return (
    <PainelFrame
      ctx={ctx}
      title={voucher.name}
      actions={
        <LinkButton href="/vouchers?aba=vouchers" variant="ghost">
          Voltar para vouchers
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="voucher-numeros" className="af-profile">
          <h2 id="voucher-numeros" className="af-section__title">
            Vendas
          </h2>
          <p>
            <strong className="af-tabular">{formatInt(voucher.sold)}</strong> vendidos, <strong className="af-tabular">{formatInt(voucher.redeemed)}</strong> usados no balcão e <strong className="af-tabular">{formatInt(voucher.stock)}</strong> em estoque.
          </p>
        </Card>
        <Card as="section" aria-labelledby="voucher-imagem" className="af-profile">
          <h2 id="voucher-imagem" className="af-section__title">
            Imagem
          </h2>
          {aviso ? (
            <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {aviso.texto}
            </p>
          ) : null}
          <ImagemUpload action={`/vouchers/${voucher.id}/imagem`} rotulo={`Imagem de ${voucher.name}`} src={voucher.imageUrl} dica="JPEG, PNG ou WebP, até 8 MB. A imagem não é cortada." />
        </Card>
        <Card as="section" aria-labelledby="voucher-dados" className="af-profile">
          <h2 id="voucher-dados" className="af-section__title">
            Dados do voucher
          </h2>
          <VoucherForm
            voucher={{ id: voucher.id, partnerId: voucher.partnerId, name: voucher.name, description: voucher.description ?? '', terms: voucher.terms ?? '', priceCents: voucher.priceCents, stock: voucher.stock, validDays: voucher.validDays, active: voucher.active }}
            parceiros={parceiros}
          />
        </Card>
      </div>
    </PainelFrame>
  )
}
