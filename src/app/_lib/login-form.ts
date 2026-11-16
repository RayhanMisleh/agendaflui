import { z } from 'zod'
import { AuthError, mensagemDeEspera } from '@/server/auth/actor'

/** Estado do formulário de entrada: o erro e o e-mail digitado (a senha nunca volta). */
export type LoginState = { error: string | null; email: string }

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
})

export const SEM_DADOS = 'Informe um e-mail válido e a sua senha.'
export const SEM_CONTA = 'Seu acesso não está ligado a nenhuma conta ativa. Fale com quem administra o seu negócio.'

/** Mensagem para a pessoa; nunca diz se foi o e-mail ou a senha que errou. */
export function mensagemDeLogin(err: AuthError): string {
  switch (err.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'rate_limited':
      return err.retryAfterSec === undefined
        ? 'Muitas tentativas. Tente de novo em alguns minutos.'
        : mensagemDeEspera(err.retryAfterSec)
    case 'account_inactive':
      return 'Este acesso está desativado. Fale com quem administra a plataforma.'
    default:
      return 'Não foi possível entrar agora. Tente de novo em instantes.'
  }
}

export function lerCampos(form: FormData): { email: string; password: string } | null {
  const email = form.get('email')
  const password = form.get('password')
  const r = loginSchema.safeParse({ email, password })
  return r.success ? r.data : null
}

export function emailDigitado(form: FormData): string {
  const e = form.get('email')
  return typeof e === 'string' ? e.slice(0, 254) : ''
}
