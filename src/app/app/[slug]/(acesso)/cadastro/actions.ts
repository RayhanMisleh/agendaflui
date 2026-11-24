'use server'
import { redirect } from 'next/navigation'
import { runAfterResponse } from '@/server/after'
import { APP_COOKIE, readCookie, setSessionCookie } from '@/server/auth/guards'
import { customerLandingPath, resolveStoreVisit } from '@/server/auth/customer-access'
import { requestInfo } from '@/server/auth/request-info'
import { setPersonPhone } from '@/server/auth/person-account'
import { confirmStoreSignup, requestStoreSignup } from '@/server/auth/store-signup'
import { DomainError } from '@/server/domain/errors'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import { AuthError, mensagemDeEspera } from '@/server/auth/actor'
import { safeReturnPath } from '@/shared/return-path'

/** Resultado de cada passo do quiz de cadastro: `ok` avança; senão, o erro geral e/ou os erros por campo. */
export type PassoCadastro = {
  ok: boolean
  /** Erro geral (loja fechada, espera, falha inesperada). */
  error: string | null
  /** Erros por campo (`name`, `email`, `password`, `code`, `phone`). */
  fields: Record<string, string>
}

const OK: PassoCadastro = { ok: true, error: null, fields: {} }

const texto = (form: FormData, nome: string, max = 320): string => {
  const v = form.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

const esperar = (erro: AuthError): string => (erro.retryAfterSec === undefined ? erro.message : mensagemDeEspera(erro.retryAfterSec))

/** Passo "e-mail e senha": valida tudo e agenda o envio do código (a resposta é a mesma exista o e-mail ou não). */
export async function pedirCodigo(form: FormData): Promise<PassoCadastro> {
  const slug = texto(form, 'slug', 60)
  try {
    const continuacao = await requestStoreSignup(
      slug,
      { name: texto(form, 'name', 200), email: texto(form, 'email'), password: texto(form, 'password', 400) },
      await requestInfo(),
      new Date(),
    )
    runAfterResponse(continuacao)
  } catch (erro) {
    if (erro instanceof AuthError) return { ok: false, error: esperar(erro), fields: {} }
    if (erro instanceof DomainError) return { ok: false, error: erro.fields ? null : erro.message, fields: { ...(erro.fields ?? {}) } }
    console.error(JSON.stringify({ level: 'error', event: 'store_signup_request_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
    return { ok: false, error: MENSAGEM_GENERICA, fields: {} }
  }
  return OK
}

/** Passo "código": confere o código, cria a conta, liga à loja e abre a sessão. O quiz segue para o WhatsApp. */
export async function confirmarCadastro(form: FormData): Promise<PassoCadastro> {
  const slug = texto(form, 'slug', 60)
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
    if (erro instanceof DomainError) return { ok: false, error: erro.fields?.['code'] ? null : erro.message, fields: { ...(erro.fields ?? {}) } }
    if (erro instanceof AuthError) return { ok: false, error: esperar(erro), fields: {} }
    console.error(JSON.stringify({ level: 'error', event: 'store_signup_confirm_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
    return { ok: false, error: MENSAGEM_GENERICA, fields: {} }
  }
  await setSessionCookie(APP_COOKIE, sessao.token, sessao.expiresAt)
  return OK
}

/**
 * Último passo: guarda o WhatsApp (se a pessoa informou; vazio é "pular") e leva para onde ela ia (quiz do pet em loja pet,
 * o `volta` ou a loja). Só vale com a sessão que o passo do código abriu; sem ela, volta para a entrada da loja.
 */
export async function concluirCadastro(form: FormData): Promise<PassoCadastro> {
  const slug = texto(form, 'slug', 60)
  const volta = safeReturnPath(slug, texto(form, 'volta', 400))
  const info = await requestInfo()
  const visita = await resolveStoreVisit({ token: await readCookie(APP_COOKIE), slug, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } })
  if (visita.kind === 'anonymous' || visita.kind === 'unavailable') redirect(`/${slug}/entrar`)
  const telefone = texto(form, 'phone', 60).trim()
  if (telefone !== '') {
    try {
      await setPersonPhone(visita.person.userId, telefone)
    } catch (erro) {
      if (erro instanceof DomainError) return { ok: false, error: erro.fields ? null : erro.message, fields: { ...(erro.fields ?? {}) } }
      console.error(JSON.stringify({ level: 'error', event: 'store_signup_phone_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
      return { ok: false, error: MENSAGEM_GENERICA, fields: {} }
    }
  }
  redirect(visita.kind === 'customer' ? await customerLandingPath(visita, volta) : `/${slug}`)
}
