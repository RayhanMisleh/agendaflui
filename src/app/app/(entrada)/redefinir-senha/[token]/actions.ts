'use server'
import { redirect } from 'next/navigation'
import { AuthError } from '@/server/auth/actor'
import { requestInfo } from '@/server/auth/request-info'
import { checkResetLimit, RESET_INVALID_MESSAGE, resetPassword } from '@/server/auth/password-reset'
import { DomainError } from '@/server/domain/errors'
import type { Campos } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'

/** As senhas nunca voltam ao navegador: `values` fica sempre vazio. */
export type EstadoRedefinir = FormState<Campos>

const texto = (form: FormData, nome: string, max: number): string => {
  const v = form.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}
const erro = (message: string | null, fields: Record<string, string> = {}): EstadoRedefinir => ({ ok: false, message, fields, values: {} })

/** Define a senha nova com o link e manda para a entrada. Link que não vale responde igual em todos os casos. */
export async function redefinirSenha(_anterior: EstadoRedefinir, form: FormData): Promise<EstadoRedefinir> {
  const token = texto(form, 'token', 200)
  const password = texto(form, 'password', 400)
  const confirm = texto(form, 'confirm', 400)
  const agora = new Date()
  const info = await requestInfo()
  try {
    await checkResetLimit(info.ip, token, agora)
  } catch (e) {
    if (e instanceof AuthError) return erro(e.message)
    throw e
  }
  if (password !== confirm) return erro(null, { confirm: 'As duas senhas precisam ser iguais.' })
  try {
    await resetPassword({ token, password }, info, agora)
  } catch (e) {
    if (e instanceof DomainError && e.code === 'validation') return erro(null, e.fields ?? {})
    if (e instanceof DomainError && e.code === 'not_found') return erro(RESET_INVALID_MESSAGE)
    throw e
  }
  redirect('/entrar?senha=nova')
}
