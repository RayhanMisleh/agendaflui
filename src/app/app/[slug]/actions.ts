'use server'
import { redirect } from 'next/navigation'
import { APP_COOKIE, readCookie, requirePerson } from '@/server/auth/guards'
import { customerLandingPath, resolveStoreVisit } from '@/server/auth/customer-access'
import { requestInfo } from '@/server/auth/request-info'
import { setSessionStore } from '@/server/auth/session'
import { findOpenStore, joinStore } from '@/server/auth/store-join'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import { safeReturnPath } from '@/shared/return-path'
import { LOJA_DESATIVADA } from './_lib/mensagens'

export type EstadoLoja = { error: string | null }

/** "Usar minha conta nesta loja": a pessoa vira cliente da loja (cria o cadastro ou adota o de balcão) e a loja vira a última usada. */
export async function usarMinhaConta(_anterior: EstadoLoja, form: FormData): Promise<EstadoLoja> {
  const bruto = form.get('slug')
  const slug = typeof bruto === 'string' ? bruto : ''
  const volta = safeReturnPath(slug, typeof form.get('volta') === 'string' ? String(form.get('volta')) : null)
  const session = await requirePerson()
  const loja = await findOpenStore(slug)
  if (!loja) return { error: 'Esta loja não está disponível agora. Confira o link com a loja.' }
  let bloqueada = false
  try {
    const r = await joinStore(session.user.id, loja.businessId, new Date())
    bloqueada = r.kind === 'blocked'
  } catch (erro) {
    console.error(JSON.stringify({ level: 'error', event: 'join_store_failed', error: erro instanceof Error ? erro.name : 'unknown' }))
    return { error: MENSAGEM_GENERICA }
  }
  if (bloqueada) return { error: LOJA_DESATIVADA }
  const token = await readCookie(APP_COOKIE)
  if (token) await setSessionStore(token, loja.businessId)
  const info = await requestInfo()
  const visita = await resolveStoreVisit({ token, slug: loja.slug, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } })
  redirect(visita.kind === 'customer' ? await customerLandingPath(visita, volta) : `/${loja.slug}`)
}
