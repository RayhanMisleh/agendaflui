'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { runAfterResponse } from '@/server/after'
import { AuthError, mensagemDeEspera } from '@/server/auth/actor'
import { APP_COOKIE, clearSessionCookie, readCookie, requirePerson, requireTenant } from '@/server/auth/guards'
import {
  confirmEmailChange,
  requestEmailChange,
  setPersonPassword,
  switchStore,
  unlinkGoogle,
  updatePersonProfile,
} from '@/server/auth/person-account'
import { logout } from '@/server/auth/session'
import { DomainError } from '@/server/domain/errors'
import { setNotifyAllAppointments } from '@/server/domain/team/staff-preferences'
import { formError } from '@/app/_lib/form-state'
import type { EstadoConta } from './_lib/estado'

/*
 * Ações de Minha conta. Toda ação lê a pessoa da SESSÃO (`requirePerson`): o formulário nunca diz de quem é a conta. Senhas e
 * códigos não voltam ao navegador (`values` só leva o que não é segredo).
 */

const texto = (fd: FormData, nome: string, max = 400): string => {
  const v = fd.get(nome)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

const depois = (anterior: EstadoConta, mudanca: Partial<EstadoConta>): EstadoConta => ({ ...anterior, ...mudanca })

const atualizar = (): void => revalidatePath('/app/conta')

/** Erro de domínio, de limite ou inesperado como estado de formulário; `redirect` e `notFound` passam adiante. */
function falha(err: unknown, anterior: EstadoConta, values: Record<string, string>, renomear: Record<string, string> = {}): EstadoConta {
  if (err instanceof AuthError) {
    return depois(anterior, { ok: false, message: err.retryAfterSec === undefined ? err.message : mensagemDeEspera(err.retryAfterSec), fields: {}, values, needsPassword: false })
  }
  const base = formError(err, values)
  const fields = Object.fromEntries(Object.entries(base.fields).map(([k, m]) => [renomear[k] ?? k, m]))
  return depois(anterior, {
    ok: false,
    message: base.message,
    fields,
    values,
    needsPassword: err instanceof DomainError && err.reason === 'needs_password',
  })
}

const certo = (anterior: EstadoConta, message: string, mudanca: Partial<EstadoConta> = {}): EstadoConta =>
  depois(anterior, { ok: true, message, fields: {}, needsPassword: false, ...mudanca })

export async function salvarDados(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const sessao = await requirePerson()
  const values = { name: texto(fd, 'name', 200), phone: texto(fd, 'phone', 60) }
  try {
    await updatePersonProfile(sessao.user.id, values)
  } catch (err) {
    return falha(err, anterior, values)
  }
  atualizar()
  return certo(anterior, 'Dados salvos.', { values })
}

/** Passo 1 da troca de e-mail: valida e agenda o código para o e-mail novo (a resposta não depende de ele existir). */
export async function pedirCodigoDeEmail(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const sessao = await requirePerson()
  const values = { email: texto(fd, 'email', 320) }
  try {
    runAfterResponse(await requestEmailChange(sessao.user.id, values, new Date()))
  } catch (err) {
    return falha(err, { ...anterior, step: 'email' }, values)
  }
  return depois(anterior, { ok: false, message: null, fields: {}, values, needsPassword: false, step: 'codigo', sent: anterior.sent + 1 })
}

/** Passo 2: confere o código, troca o e-mail (e as cópias nas lojas) e, se for o caso, desvincula o Google. */
export async function confirmarEmail(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const sessao = await requirePerson()
  const values = { email: texto(fd, 'email', 320) }
  let desvinculou: boolean
  try {
    desvinculou = (await confirmEmailChange(sessao.user.id, { ...values, code: texto(fd, 'code', 20) }, new Date())).googleUnlinked
  } catch (err) {
    // O código errado mantém o passo do código; os conflitos de e-mail voltam ao campo do e-mail.
    const conflito = err instanceof DomainError && err.reason !== 'invalid_code'
    return falha(err, { ...anterior, step: conflito ? 'email' : 'codigo' }, values)
  }
  atualizar()
  return certo(anterior, desvinculou ? 'E-mail trocado. O Google foi desvinculado.' : 'E-mail trocado.', { values: {}, step: 'email', sent: 0 })
}

export async function salvarSenha(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const sessao = await requirePerson()
  const nova = texto(fd, 'senhaNova', 200)
  if (nova !== texto(fd, 'senhaConfirma', 200)) {
    return depois(anterior, { ok: false, message: 'Confira os campos informados e tente de novo.', fields: { senhaConfirma: 'As duas senhas novas precisam ser iguais.' }, values: {}, needsPassword: false })
  }
  const token = (await readCookie(APP_COOKIE)) ?? ''
  try {
    const atual = texto(fd, 'senhaAtual', 200)
    await setPersonPassword(sessao.user.id, { ...(atual !== '' ? { current: atual } : {}), next: nova }, token, new Date())
  } catch (err) {
    return falha(err, anterior, {}, { current: 'senhaAtual', next: 'senhaNova' })
  }
  atualizar()
  return certo(anterior, 'Senha salva.', { values: {} })
}

export async function desvincularGoogle(anterior: EstadoConta): Promise<EstadoConta> {
  const sessao = await requirePerson()
  try {
    await unlinkGoogle(sessao.user.id, new Date())
  } catch (err) {
    return falha(err, anterior, {})
  }
  atualizar()
  return certo(anterior, 'Google desvinculado.')
}

export async function trocarLoja(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const sessao = await requirePerson()
  const token = (await readCookie(APP_COOKIE)) ?? ''
  let slug: string
  try {
    slug = (await switchStore(token, sessao.user.id, texto(fd, 'businessId', 60))).slug
  } catch (err) {
    return falha(err, anterior, {})
  }
  redirect(`/${slug}`)
}

/** Dono e gerente ligam ou desligam o e-mail com os avisos de todos os agendamentos; o domínio recusa os demais. */
export async function salvarAvisosDaLoja(anterior: EstadoConta, fd: FormData): Promise<EstadoConta> {
  const ctx = await requireTenant()
  const ligado = texto(fd, 'value', 10) === 'on'
  try {
    await setNotifyAllAppointments(ctx, ligado)
  } catch (err) {
    return falha(err, anterior, {})
  }
  atualizar()
  return certo(anterior, ligado ? 'Avisos ligados.' : 'Avisos desligados.', { values: { value: ligado ? 'on' : '' } })
}

export async function sair(): Promise<void> {
  const token = await readCookie(APP_COOKIE)
  if (token) await logout(token)
  await clearSessionCookie(APP_COOKIE)
  redirect('/entrar')
}
