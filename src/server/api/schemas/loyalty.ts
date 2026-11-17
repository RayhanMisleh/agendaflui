import { z } from '@/server/domain/errors'
import { isoInstant, uuid } from '../wire'

/*
 * Esquemas de resposta (formato de fio) da Fidelidade. O estoque do prêmio nunca sai: só `available`.
 */

export const loyaltyEntrySchema = z.object({
  id: uuid,
  kind: z.enum(['EARN', 'EARN_REVERSAL', 'REDEEM', 'REDEEM_REVERSAL', 'ADJUST']),
  points: z.number().describe('Com sinal: crédito positivo, débito negativo.'),
  reason: z.string().nullable(),
  appointmentId: uuid.nullable(),
  redemptionId: uuid.nullable(),
  createdAt: isoInstant,
  createdLabel: z.string(),
})

export const loyaltyMeSchema = z.object({
  balance: z.number(),
  clubMember: z.boolean(),
  terms: z.object({ points: z.object({ singular: z.string(), plural: z.string() }), club: z.string() }),
})

export const prizeSchema = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  costPoints: z.number(),
  imageUrl: z.string().nullable(),
  available: z.boolean(),
})

export const redemptionSchema = z.object({
  id: uuid,
  status: z.enum(['PENDING', 'DELIVERED', 'CANCELED']),
  prize: z.object({ id: uuid, name: z.string() }),
  costPoints: z.number(),
  customer: z.object({ id: uuid, name: z.string() }),
  createdLabel: z.string(),
  deliveredLabel: z.string().nullable(),
  canceledLabel: z.string().nullable(),
  cancelReason: z.string().nullable(),
})

export const rankingSchema = z.object({
  enabled: z.boolean(),
  month: z.string().describe('Mês local da conta, AAAA-MM.'),
  entries: z.array(z.object({ position: z.number(), firstName: z.string(), avatarUrl: z.string().nullable(), points: z.number() })),
})
