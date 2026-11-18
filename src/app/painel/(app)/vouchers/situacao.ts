import type { VoucherCodeStatus } from '@/server/domain/vouchers/codes'
import type { BadgeTone } from '@/ui/components'

/** A situação de um código em texto (a cor nunca vai sozinha) e o tom do selo. */
export const SITUACAO_DO_CODIGO: Record<VoucherCodeStatus, { text: string; tone: BadgeTone }> = {
  ACTIVE: { text: 'Válido', tone: 'confirmed' },
  REDEEMED: { text: 'Usado', tone: 'done' },
  VOID: { text: 'Anulado', tone: 'canceled' },
  EXPIRED: { text: 'Vencido', tone: 'no-show' },
}
