import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getAppointment } from '@/server/domain/scheduling/appointments'
import { todayIn } from '@/server/time'
import { AgendarFluxo } from '../../../agendar/AgendarFluxo'
import { ClienteFrame } from '../../../_lib/ClienteFrame'
import { metadataDaLoja } from '../../../_lib/loja'

type Props = { params: Promise<{ slug: string; id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Remarcar')
}

/** Remarcar: o mesmo fluxo do Agendar, só com profissional e horário (pet e serviços ficam). Fora do prazo, volta ao horário. */
export default async function RemarcarPage({ params }: Props) {
  const { slug, id } = await params
  const visit = await requireCustomer(slug, `/${slug}/horarios/${id}/remarcar`)
  const a = await getAppointment(visit.ctx, id).catch((err: unknown) => {
    if (err instanceof DomainError && (err.code === 'not_found' || err.code === 'forbidden')) return notFound()
    throw err
  })
  const aberto = a.status === 'PENDING' || a.status === 'CONFIRMED'
  if (!aberto || !a.change.allowed || a.endsAt.getTime() <= visit.ctx.clock().getTime()) return redirect(`/${slug}/horarios/${id}`)
  return (
    <ClienteFrame visit={visit} title="Remarcar" hideTitle immersive>
      <AgendarFluxo
        slug={slug}
        today={todayIn(visit.ctx.timeZone, visit.ctx.clock())}
        pets={[]}
        modo="remarcar"
        remarcacao={{
          id: a.id,
          petId: a.pet?.id ?? null,
          petName: a.pet?.name ?? null,
          serviceIds: a.items.map((i) => i.serviceId),
          services: a.items.map((i) => ({ name: i.name, priceCents: i.priceCents })),
          totalCents: a.totalCents,
          professionalId: a.professional.id,
          professionalName: a.professional.name,
        }}
      />
    </ClienteFrame>
  )
}
