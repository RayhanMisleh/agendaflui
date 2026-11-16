import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { customerProfileSchema } from '@/server/api/booking-schemas'
import { deleteOwnAccount, ownCustomerId } from '@/server/domain/customers/account'
import { getCustomer, updateCustomer } from '@/server/domain/customers/customers'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/me',
  auth: 'customer',
  summary: 'Cadastro do cliente que entrou',
  tag: 'Conta do cliente',
  response: customerProfileSchema,
  handler: async ({ ctx }) => getCustomer(ctx, ownCustomerId(ctx)),
})

// `notes` e `isClubMember` são nomes conhecidos de propósito: o domínio os recusa com 403 (são da equipe).
// Qualquer outro campo é erro 422. O e-mail não muda por aqui: ele é a entrada da conta e exige confirmação.
export const PATCH = defineRoute({
  method: 'PATCH',
  path: '/v1/me',
  auth: 'customer',
  summary: 'Altera nome, telefone ou data de nascimento do cliente',
  tag: 'Conta do cliente',
  body: z
    .object({
      name: z.string().max(200),
      phone: z.string().max(40).nullable(),
      birthDate: z.string().max(10).nullable(),
      notes: z.string().max(5000).nullable(),
      isClubMember: z.boolean(),
    })
    .partial(),
  response: customerProfileSchema,
  handler: async ({ ctx, body }) => updateCustomer(ctx, ownCustomerId(ctx), body),
})

export const DELETE = defineRoute({
  method: 'DELETE',
  path: '/v1/me',
  auth: 'customer',
  status: 204,
  summary: 'Exclui a conta do cliente (confirma com a senha); os dados pessoais são anonimizados',
  tag: 'Conta do cliente',
  body: z.object({ password: credentialText }),
  response: z.undefined(),
  handler: async ({ ctx, body }) => deleteOwnAccount(ctx, body),
})

export const OPTIONS = preflight
