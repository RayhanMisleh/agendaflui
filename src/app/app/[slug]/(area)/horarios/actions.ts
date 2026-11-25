'use server'
import { redirect } from 'next/navigation'
import { ler } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'
import { DomainError } from '@/server/domain/errors'
import { cancelAppointment } from '@/server/domain/scheduling/appointment-status-ops'
import { getStorefront } from '@/server/domain/storefront/storefront'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'

/*
 * Cancelar o próprio horário. O cliente vem da sessão (`clienteAction`) e o `appointmentId` do formulário nunca é autoridade:
 * o domínio só o encontra se for deste cliente (o de outro cliente ou de outra loja é "não encontrado"). Depois do prazo, a
 * recusa é a do domínio com o telefone da loja, para a pessoa saber a quem falar.
 */

export const cancelarHorario = clienteAction(
  (fd) => ler(fd, ['appointmentId']),
  async (v, c) => {
    try {
      await cancelAppointment(v.ctx, c.appointmentId ?? '', { reason: null })
    } catch (err) {
      if (err instanceof DomainError && err.reason === 'too_late') {
        const telefone = (await getStorefront(v.ctx)).phone
        if (telefone) throw new DomainError(err.code, `${err.message} Fale com a loja: ${telefone.label}.`, { reason: 'too_late' })
      }
      throw err
    }
    return v.store.slug
  },
  (slug): FormState<Record<string, string>> => {
    atualizarLoja()
    return redirect(`/${slug}/horarios?cancelado=1`)
  },
)
