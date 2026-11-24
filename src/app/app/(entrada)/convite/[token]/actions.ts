'use server'
import { redirect } from 'next/navigation'
import { AuthError } from '@/server/auth/actor'
import { acceptInvite, checkInviteLimit, INVITE_INVALID_MESSAGE } from '@/server/auth/invites'
import { requestInfo } from '@/server/auth/request-info'
import { DomainError } from '@/server/domain/errors'

/** Estado do formulário: um erro geral e/ou o erro de cada campo (as senhas nunca voltam ao navegador). */
export type DefinirSenhaState = { error: string | null; fields: Record<string, string> }

function texto(form: FormData, nome: string, max: number): string {
  const v = form.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** Define a senha com o convite e manda para a entrada. Convite que não vale responde igual em todos os casos. */
export async function definirSenha(_anterior: DefinirSenhaState, form: FormData): Promise<DefinirSenhaState> {
  const token = texto(form, 'token', 200)
  const password = texto(form, 'password', 400)
  const confirm = texto(form, 'confirm', 400)
  const agora = new Date()
  try {
    await checkInviteLimit((await requestInfo()).ip, token, agora)
  } catch (erro) {
    if (erro instanceof AuthError) return { error: erro.message, fields: {} }
    throw erro
  }
  if (password !== confirm) return { error: null, fields: { confirm: 'As duas senhas precisam ser iguais.' } }
  try {
    await acceptInvite({ token, password }, agora)
  } catch (erro) {
    if (erro instanceof DomainError && erro.code === 'validation') return { error: null, fields: erro.fields ?? {} }
    if (erro instanceof DomainError && erro.code === 'not_found') return { error: INVITE_INVALID_MESSAGE, fields: {} }
    throw erro
  }
  redirect('/entrar')
}
