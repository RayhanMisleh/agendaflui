'use server'
import { redirect } from 'next/navigation'
import { emailDigitado, lerCampos, mensagemDeLogin, SEM_DADOS } from '@/app/_lib/login-form'
import type { LoginState } from '@/app/_lib/login-form'
import { requestInfo } from '@/server/auth/request-info'
import { AuthError } from '@/server/auth/actor'
import { destinationForUser, destinationPath } from '@/server/auth/destination'
import { APP_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { loginWithPassword } from '@/server/auth/session'

/** Entrada geral: e-mail e senha; o cadastro da pessoa decide o destino (painel, loja ou tela sem loja). */
export async function entrar(_anterior: LoginState, form: FormData): Promise<LoginState> {
  const campos = lerCampos(form)
  if (!campos) return { error: SEM_DADOS, email: emailDigitado(form) }
  let entrada: Awaited<ReturnType<typeof loginWithPassword>>
  try {
    const anterior = await readCookie(APP_COOKIE)
    entrada = await loginWithPassword({ ...campos, ...(await requestInfo()), ...(anterior ? { previousToken: anterior } : {}) }, new Date())
  } catch (erro) {
    if (erro instanceof AuthError) return { error: mensagemDeLogin(erro), email: campos.email }
    throw erro
  }
  await setSessionCookie(APP_COOKIE, entrada.token, entrada.expiresAt)
  redirect(destinationPath(await destinationForUser(entrada.userId, null)))
}
