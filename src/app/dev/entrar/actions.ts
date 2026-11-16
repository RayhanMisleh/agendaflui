'use server'
import { redirect } from 'next/navigation'
import { emailDigitado, lerCampos, mensagemDeLogin, SEM_DADOS } from '@/app/_lib/login-form'
import type { LoginState } from '@/app/_lib/login-form'
import { requestInfo } from '@/server/auth/request-info'
import { AuthError } from '@/server/auth/actor'
import { DEV_COOKIE, setSessionCookie } from '@/server/auth/guards'
import { loginPlatformAdmin } from '@/server/auth/platform-auth'

export async function loginAdmin(_anterior: LoginState, form: FormData): Promise<LoginState> {
  const campos = lerCampos(form)
  if (!campos) return { error: SEM_DADOS, email: emailDigitado(form) }
  let sessao: { token: string; expiresAt: Date }
  try {
    sessao = await loginPlatformAdmin({ ...campos, ...(await requestInfo()) })
  } catch (erro) {
    if (erro instanceof AuthError) return { error: mensagemDeLogin(erro), email: campos.email }
    throw erro
  }
  await setSessionCookie(DEV_COOKIE, sessao.token, sessao.expiresAt)
  redirect('/')
}
