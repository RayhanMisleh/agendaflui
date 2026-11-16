'use server'
import { redirect } from 'next/navigation'
import { emailDigitado, lerCampos, mensagemDeLogin, SEM_CONTA, SEM_DADOS } from '@/app/_lib/login-form'
import type { LoginState } from '@/app/_lib/login-form'
import { requestInfo } from '@/server/auth/request-info'
import { AuthError } from '@/server/auth/actor'
import { PAINEL_COOKIE, readCookie, setBrandCookie, setSessionCookie } from '@/server/auth/guards'
import { loginUser, logoutUser } from '@/server/auth/member-auth'

export async function loginMember(_anterior: LoginState, form: FormData): Promise<LoginState> {
  const campos = lerCampos(form)
  if (!campos) return { error: SEM_DADOS, email: emailDigitado(form) }
  let entrada: Awaited<ReturnType<typeof loginUser>>
  try {
    const anterior = await readCookie(PAINEL_COOKIE)
    entrada = await loginUser({ ...campos, ...(await requestInfo()), ...(anterior ? { previousToken: anterior } : {}) })
  } catch (erro) {
    if (erro instanceof AuthError) return { error: mensagemDeLogin(erro), email: campos.email }
    throw erro
  }
  const { memberships } = entrada.session
  const unica = memberships.length === 1 ? memberships[0] : undefined
  if (memberships.length === 0) {
    // Nenhuma conta ativa: a sessão recém-criada não serve para nada e é encerrada na hora.
    await logoutUser(entrada.token)
    return { error: SEM_CONTA, email: campos.email }
  }
  await setSessionCookie(PAINEL_COOKIE, entrada.token, entrada.expiresAt)
  if (unica) {
    await setBrandCookie(unica.slug)
    redirect('/')
  }
  redirect('/escolher-conta')
}
