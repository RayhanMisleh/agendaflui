import { normalizeEmail } from '@/server/domain/customers/contact'
import { z } from '@/server/domain/errors'

/** E-mail da pessoa: normalizado (minúsculas, sem espaços); inválido vira erro do campo. */
export const emailSchema = z.string().transform((v, ctx) => {
  try {
    return normalizeEmail(v)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof RangeError ? e.message : 'Informe um e-mail válido.' })
    return z.NEVER
  }
})

/** Nome da pessoa: sem espaços nas pontas, de 1 a 120 caracteres. */
export const personNameSchema = z.string().trim().min(1, 'Informe o nome.').max(120, 'Use no máximo 120 caracteres.')
