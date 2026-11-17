'use server'
import { revalidatePath } from 'next/cache'
import { retryFailedNotification } from '@/server/domain/platform/system'
import { feito, porAlvo } from '../_lib/campos'

/** Devolve um aviso em falha para a fila. O id vem ligado no servidor; o domínio recusa o que não está mais em falha. */
export const tentarDeNovo = porAlvo(
  [],
  (admin, _v, id) => retryFailedNotification(admin, id, new Date()),
  (_r, v) => {
    revalidatePath('/dev/sistema')
    return feito('Aviso devolvido à fila.', v)
  },
)
