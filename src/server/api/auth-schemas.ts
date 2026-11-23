import { z } from '@/server/domain/errors'
import { isoInstant, uuid } from './wire'

/** Par de tokens como sai no JSON. */
export const tokensSchema = z.object({
  accessToken: z.string(),
  accessExpiresAt: isoInstant,
  refreshToken: z.string(),
  refreshExpiresAt: isoInstant,
})

export const customerSummarySchema = z.object({ id: uuid, name: z.string(), email: z.string() })

/** Resposta de cadastro confirmado e de entrada do cliente. */
export const customerSessionSchema = z.object({ tokens: tokensSchema, customer: customerSummarySchema })

/** Resposta de "enviamos um código": a mesma exista o e-mail ou não. */
export const verificationSentSchema = z.object({ status: z.literal('verification_sent') })

/** Texto de campo de credencial: a validação de verdade (formato, tamanho mínimo) é do domínio; aqui só um teto. */
export const credentialText = z.string().max(500)

/** Quem entrou no app da equipe (resposta do login). */
export const staffMemberSchema = z.object({
  userId: uuid,
  membershipId: uuid,
  name: z.string(),
  role: z.enum(['OWNER', 'MANAGER', 'PROFESSIONAL']),
  professionalId: uuid.nullable(),
})

/** A loja onde a equipe entrou, descoberta pelo vínculo ativo (o app guarda o `slug` para o `X-Business`). */
export const staffLoginBusinessSchema = z.object({ id: uuid, slug: z.string(), name: z.string() })
