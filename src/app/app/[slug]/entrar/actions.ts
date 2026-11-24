'use server'
import { redirect } from 'next/navigation'
import { emailDigitado, lerCampos, mensagemDeLogin, SEM_DADOS } from '@/app/_lib/login-form'
import type { LoginState } from '@/app/_lib/login-form'
import { AuthError } from '@/server/auth/actor'
import { APP_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { requestInfo } from '@/server/auth/request-info'
import { signInAtStore } from '@/server/auth/store-signup'
import { DomainError } from '@/server/domain/errors'

/** Entrar pela loja: a pessoa entra com a conta dela e vira cliente da loja (ou adota o cadastro de balcão). */
export async function entrarNaLoja(_anterior: LoginState, form: FormData): Promise<LoginState> {
  const bruto = form.get('slug')
  const slug = typeof bruto === 'string' ? bruto : ''
  const campos = lerCampos(form)
  if (!campos) return { error: SEM_DADOS, email: emailDigitado(form) }
  let entrada: Awaited<ReturnType<typeof signInAtStore>>
  try {
    const anterior = await readCookie(APP_COOKIE)
    entrada = await signInAtStore(slug, campos, { ...(await requestInfo()), ...(anterior ? { previousToken: anterior } : {}) }, new Date())
  } catch (erro) {
    if (erro instanceof AuthError) return { error: mensagemDeLogin(erro), email: campos.email }
    if (erro instanceof DomainError) return { error: erro.message, email: campos.email }
    throw erro
  }
  await setSessionCookie(APP_COOKIE, entrada.token, entrada.expiresAt)
  redirect(`/${slug}`)
}
