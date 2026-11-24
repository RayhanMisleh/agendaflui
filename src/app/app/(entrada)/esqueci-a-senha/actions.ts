'use server'
import { runAfterResponse } from '@/server/after'
import { requestInfo } from '@/server/auth/request-info'
import { requestPasswordReset } from '@/server/auth/password-reset'
import { DomainError } from '@/server/domain/errors'
import type { Campos } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'

export type EstadoEsqueci = FormState<Campos>

const MENSAGEM_ENVIADO = 'Se houver uma conta com este e-mail, enviamos as instruções.'

/**
 * "Esqueci a senha". A resposta é a mesma para e-mail que existe e que não existe: o domínio só valida o formato aqui e
 * devolve o resto (limites, consulta, token e envio) para depois da resposta.
 */
export async function esqueciASenha(_anterior: EstadoEsqueci, form: FormData): Promise<EstadoEsqueci> {
  const bruto = form.get('email')
  const email = typeof bruto === 'string' ? bruto.slice(0, 320) : ''
  try {
    runAfterResponse(await requestPasswordReset(email, await requestInfo(), new Date()))
  } catch (erro) {
    if (erro instanceof DomainError && erro.code === 'validation') {
      return { ok: false, message: null, fields: { email: erro.fields?.email ?? erro.message }, values: { email } }
    }
    throw erro
  }
  return { ok: true, message: MENSAGEM_ENVIADO, fields: {}, values: { email } }
}
