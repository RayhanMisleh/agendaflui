import 'server-only'
import type { CustomerVisit } from '@/server/auth/customer-access'
import { DomainError } from '@/server/domain/errors'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'

export const POR_PAGINA = 10

/**
 * Os horários do próprio cliente: próximos (do mais perto ao mais longe) ou anteriores (do mais recente ao mais antigo), em
 * páginas por cursor. Cursor adulterado volta à primeira página em vez de quebrar a tela.
 */
export async function listarHorarios(visit: CustomerVisit, o: { anteriores: boolean; depois?: string }): Promise<{ items: AppointmentView[]; nextCursor: string | null }> {
  const scope = o.anteriores ? 'past' : 'upcoming'
  try {
    return await listCustomerAppointments(visit.ctx, { scope, limit: POR_PAGINA, ...(o.depois ? { cursor: o.depois } : {}) })
  } catch (err) {
    if (o.depois && err instanceof DomainError && err.code === 'validation') return listCustomerAppointments(visit.ctx, { scope, limit: POR_PAGINA })
    throw err
  }
}
