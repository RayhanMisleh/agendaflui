import { prisma } from '@/server/db/client'

/**
 * Confere as invariantes do encaixe da conta, direto no banco. Devolve as violações (vazio = ok):
 * (a) dois normais ativos sobrepostos do mesmo profissional; (b) encaixe ativo que não sobrepõe nenhum normal ativo do mesmo profissional.
 */
export async function invariantesDoEncaixe(businessId: string): Promise<string[]> {
  const ativos = await prisma.appointment.findMany({
    where: { businessId, status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] } },
    select: { id: true, professionalId: true, startsAt: true, endsAt: true, isSqueezeIn: true },
  })
  const sobrepoe = (a: (typeof ativos)[number], b: (typeof ativos)[number]) =>
    a.id !== b.id && a.professionalId === b.professionalId && a.startsAt < b.endsAt && b.startsAt < a.endsAt
  const erros: string[] = []
  const normais = ativos.filter((a) => !a.isSqueezeIn)
  for (const a of normais) {
    for (const b of normais) if (a.id < b.id && sobrepoe(a, b)) erros.push(`normais sobrepostos: ${a.id} e ${b.id}`)
  }
  for (const e of ativos.filter((a) => a.isSqueezeIn)) {
    if (!normais.some((n) => sobrepoe(e, n))) erros.push(`encaixe sem normal: ${e.id}`)
  }
  return erros
}
