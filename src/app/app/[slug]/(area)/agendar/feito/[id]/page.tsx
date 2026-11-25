import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getAppointment } from '@/server/domain/scheduling/appointments'
import { formatLongDate } from '@/ui/format'
import { ClientePagina } from '@/ui/shells'
import { metadataDaLoja } from '../../../../_lib/loja'
import { Sucesso } from './Sucesso'

type Props = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Horário marcado')
}

/** Depois de marcar ou remarcar. O agendamento de outro cliente (ou de outra loja) não existe aqui: 404. */
export default async function FeitoPage({ params, searchParams }: Props) {
  const { slug, id } = await params
  const visit = await requireCustomer(slug, `/${slug}/agendar/feito/${id}`)
  const a = await getAppointment(visit.ctx, id).catch((err: unknown) => {
    if (err instanceof DomainError && (err.code === 'not_found' || err.code === 'forbidden')) return notFound()
    throw err
  })
  return (
    <ClientePagina title="Horário marcado" hideTitle>
      <Sucesso
        slug={slug}
        d={{
          id: a.id,
          status: a.status,
          remarcado: um((await searchParams).remarcado) === '1',
          dia: formatLongDate(a.local.date),
          hora: a.local.start,
          pet: a.pet?.name ?? null,
          servicos: a.items.map((i) => i.name),
          profissional: a.professional.name,
          totalCents: a.totalCents,
        }}
      />
    </ClientePagina>
  )
}
