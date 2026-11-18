import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../../PainelFrame'
import { requirePainelModule } from '../../../_lib/modulo'
import { ParceiroForm } from '../../ParceiroForm'

export const metadata: Metadata = { title: 'Novo parceiro | AgendaFlui' }

export default async function NovoParceiroPage() {
  const ctx = await requireTenant('manage_vouchers')
  await requirePainelModule(ctx, 'vouchers')
  return (
    <PainelFrame
      ctx={ctx}
      title="Novo parceiro"
      actions={
        <LinkButton href="/vouchers?aba=parceiros" variant="ghost">
          Voltar para parceiros
        </LinkButton>
      }
    >
      <Card as="section" aria-labelledby="parceiro-novo" className="af-profile af-profile--narrow">
        <h2 id="parceiro-novo" className="af-section__title">
          Dados do parceiro
        </h2>
        <p className="af-section__help">Depois de criar, você envia o logo.</p>
        <ParceiroForm parceiro={null} />
      </Card>
    </PainelFrame>
  )
}
