import { appointmentSchema, customerProfileSchema } from '@/server/api/booking-schemas'
import type { CustomerView } from '@/server/domain/customers/customers'
import { z } from '@/server/domain/errors'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'

/*
 * Esquemas de resposta (formato de fio) compartilhados pelas rotas da equipe. São os do cliente mais os campos
 * internos que só a equipe vê. A comissão e a anotação do agendamento vêm `null` quando quem lê não é o dono da
 * agenda nem enxerga todas.
 */

export const staffAppointmentSchema = appointmentSchema.extend({
  commissionCents: z.number().nullable(),
  notes: z.string().nullable(),
})

export const staffCustomerSchema = customerProfileSchema.extend({ notes: z.string().nullable() })

/** Lista de agendamentos paginada por cursor, como as rotas de equipe e de cliente devolvem. */
export const staffAppointmentPageSchema = z.object({ items: z.array(staffAppointmentSchema), nextCursor: z.string().nullable() })

/*
 * O domínio devolve um tipo só para o cliente e para a equipe (os campos internos são opcionais nele). Para a
 * equipe as chaves sempre existem (`null` quando o ator não as vê); estes dois ajudantes confirmam isso e dão o
 * tipo exato ao esquema. Chave ausente aqui é erro de programação, nunca resposta.
 */

export function staffAppointment(view: AppointmentView) {
  const { commissionCents, notes } = view
  if (commissionCents === undefined || notes === undefined) throw new Error('A visão do agendamento não é a da equipe.')
  return { ...view, commissionCents, notes }
}

export function staffCustomer(view: CustomerView) {
  const { notes } = view
  if (notes === undefined) throw new Error('A visão do cliente não é a da equipe.')
  return { ...view, notes }
}
