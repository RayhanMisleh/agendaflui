'use server'
import { redirect } from 'next/navigation'
import { erroDeCampo, ler } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'
import { assertCustomerRate } from '@/server/auth/customer-access'
import { DomainError } from '@/server/domain/errors'
import { bookAppointment, rescheduleAppointment } from '@/server/domain/scheduling/appointments'
import { fromIsoInstant } from '@/server/time'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'
import { OCUPADO } from './mensagens'

/*
 * Marcar e remarcar pelo cliente. O cliente vem sempre da sessão (`clienteAction`); `petId`, `serviceIds` e `appointmentId` do
 * formulário nunca são autoridade: o domínio só os encontra se forem deste cliente. A chave de idempotência (`key`) faz o toque
 * duplo gravar um agendamento só. O horário que outro cliente tomou no meio do caminho volta como `conflict` com sugestões.
 */


type Campos = Record<string, string>

function instante(texto: string | undefined): Date {
  try {
    return fromIsoInstant(texto ?? '')
  } catch {
    throw erroDeCampo('startsAt', 'Escolha um horário.')
  }
}

/** Horário tomado ou fora da grade: mesma mensagem, e o `reason` único faz o estado levar as sugestões (`conflict`). */
function ocupado(err: unknown): unknown {
  if (err instanceof DomainError && (err.reason === 'slot_taken' || err.reason === 'slot_unavailable')) {
    return new DomainError(err.code, OCUPADO, { reason: 'slot_taken', ...(err.details ? { details: err.details } : {}) })
  }
  return err
}

export const marcarHorario = clienteAction(
  (fd): Campos => ({ ...ler(fd, ['petId', 'professionalId', 'startsAt', 'customerNote', 'key']), serviceIds: fd.getAll('serviceIds').filter((x) => typeof x === 'string').join(',') }),
  async (v, c) => {
    await assertCustomerRate(v, 'booking', v.ctx.clock())
    const startsAt = instante(c.startsAt)
    const serviceIds = (c.serviceIds ?? '').split(',').filter((s) => s !== '')
    try {
      return await bookAppointment(v.ctx, {
        serviceIds,
        petId: c.petId === '' ? null : (c.petId ?? null),
        professionalId: c.professionalId === '' ? null : (c.professionalId ?? null),
        startsAt,
        customerNote: c.customerNote ?? null,
        ...((c.key ?? '') === '' ? {} : { idempotencyKey: c.key }),
      })
    } catch (err) {
      throw ocupado(err)
    }
  },
  (a, c, v): FormState<Campos> => {
    atualizarLoja()
    return redirect(`/${v.store.slug}/agendar/feito/${a.id}`)
  },
)

export const remarcarHorario = clienteAction(
  (fd): Campos => ler(fd, ['appointmentId', 'startsAt', 'professionalId']),
  async (v, c) => {
    await assertCustomerRate(v, 'booking', v.ctx.clock())
    const startsAt = instante(c.startsAt)
    try {
      return await rescheduleAppointment(v.ctx, c.appointmentId ?? '', { startsAt, professionalId: c.professionalId === '' ? null : (c.professionalId ?? null) })
    } catch (err) {
      throw ocupado(err)
    }
  },
  (a, c, v): FormState<Campos> => {
    atualizarLoja()
    return redirect(`/${v.store.slug}/agendar/feito/${a.id}?remarcado=1`)
  },
)
