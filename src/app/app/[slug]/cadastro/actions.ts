'use server'
import { redirect } from 'next/navigation'
import { runAfterResponse } from '@/server/after'
import { APP_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { customerLandingPath, resolveStoreVisit } from '@/server/auth/customer-access'
import { requestInfo } from '@/server/auth/request-info'
import { confirmStoreSignup, requestStoreSignup } from '@/server/auth/store-signup'
import { DomainError } from '@/server/domain/errors'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import { AuthError, mensagemDeEspera } from '@/server/auth/actor'
import { safeReturnPath } from '@/shared/return-path'

export type EstadoCadastro = {
  step: 'dados' | 'codigo'
  /** Erro geral (loja fechada, falha inesperada). */
  error: string | null
  /** Erros por campo. */
  fields: Record<string, string>
  /** O que a pessoa digitou (nunca a senha). */
  values: { name: string; email: string; phone: string }
  /** Quantos códigos já foram pedidos nesta tela (o "Enviamos outro código" aparece a partir do segundo). */
  sent: number
}

export type EstadoCodigo = { error: string | null; fields: Record<string, string> }

const texto = (form: FormData, nome: string, max = 320): string => {
  const v = form.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** Passo 1: valida os dados e agenda o envio do código (a resposta é a mesma exista o e-mail ou não). */
export async function pedirCodigo(anterior: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const slug = texto(form, 'slug', 60)
  const values = { name: texto(form, 'name', 200), email: texto(form, 'email'), phone: texto(form, 'phone', 60) }
  try {
    const continuacao = await requestStoreSignup(slug, { ...values, password: texto(form, 'password', 400) }, await requestInfo(), new Date())
    runAfterResponse(continuacao)
  } catch (erro) {
    if (erro instanceof DomainError) return { step: 'dados', error: erro.fields ? null : erro.message, fields: { ...(erro.fields ?? {}) }, values, sent: anterior.sent }
    console.error(JSON.stringify({ level: 'error', event: 'store_signup_request_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
    return { step: 'dados', error: MENSAGEM_GENERICA, fields: {}, values, sent: anterior.sent }
  }
  return { step: 'codigo', error: null, fields: {}, values, sent: anterior.sent + 1 }
}

/** Passo 2: confere o código, cria a conta, liga à loja e entra. */
export async function confirmarCadastro(_anterior: EstadoCodigo, form: FormData): Promise<EstadoCodigo> {
  const slug = texto(form, 'slug', 60)
  const volta = safeReturnPath(slug, texto(form, 'volta', 400))
  const info = await requestInfo()
  let sessao: Awaited<ReturnType<typeof confirmStoreSignup>>
  try {
    const anterior = await readCookie(APP_COOKIE)
    sessao = await confirmStoreSignup(
      slug,
      { email: texto(form, 'email'), code: texto(form, 'code', 20) },
      { ...info, ...(anterior ? { previousToken: anterior } : {}) },
      new Date(),
    )
  } catch (erro) {
    if (erro instanceof DomainError) return { error: erro.fields?.['code'] ? null : erro.message, fields: { ...(erro.fields ?? {}) } }
    if (erro instanceof AuthError) return { error: erro.retryAfterSec === undefined ? erro.message : mensagemDeEspera(erro.retryAfterSec), fields: {} }
    console.error(JSON.stringify({ level: 'error', event: 'store_signup_confirm_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
    return { error: MENSAGEM_GENERICA, fields: {} }
  }
  await setSessionCookie(APP_COOKIE, sessao.token, sessao.expiresAt)
  const visita = await resolveStoreVisit({ token: sessao.token, slug, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } })
  redirect(visita.kind === 'customer' ? await customerLandingPath(visita, volta) : `/${slug}`)
}
