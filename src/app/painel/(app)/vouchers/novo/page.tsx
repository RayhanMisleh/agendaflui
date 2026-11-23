import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listPartners } from '@/server/domain/vouchers/partners'
import { Card, EmptyState, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../PainelFrame'
import { requirePainelModule } from '../../_lib/modulo'
import { VoucherForm } from '../VoucherForm'

export const metadata: Metadata = { title: 'Novo voucher | Agenda Flui' }

export default async function NovoVoucherPage() {
  const ctx = await requireTenant('manage_vouchers')
  await requirePainelModule(ctx, 'vouchers')
  const parceiros = (await listPartners(ctx)).filter((p) => p.active)
  return (
    <PainelFrame
      ctx={ctx}
      title="Novo voucher"
      actions={
        <LinkButton href="/vouchers?aba=vouchers" variant="ghost">
          Voltar para vouchers
        </LinkButton>
      }
    >
      <Card as="section" aria-labelledby="voucher-novo" className="af-profile af-profile--narrow">
        <h2 id="voucher-novo" className="af-section__title">
          Dados do voucher
        </h2>
        {parceiros.length === 0 ? (
          <EmptyState title="Cadastre um parceiro primeiro" description="Todo voucher é de um parceiro ativo." action={<LinkButton href="/vouchers/parceiros/novo">Novo parceiro</LinkButton>} />
        ) : (
          <>
            <p className="af-section__help">Depois de criar, você envia a imagem do voucher.</p>
            <VoucherForm voucher={null} parceiros={parceiros.map((p) => ({ id: p.id, name: p.name }))} />
          </>
        )}
      </Card>
    </PainelFrame>
  )
}
