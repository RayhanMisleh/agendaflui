'use server'
import { redirect } from 'next/navigation'
import { areaLink } from '@/server/area-links'
import { clearSessionCookie, APP_COOKIE, readCookie } from '@/server/auth/guards'
import { logoutUser } from '@/server/auth/member-auth'
import { endSupport } from '@/server/auth/support-session'

/** Revoga a sessão no banco e apaga o cookie. A marca lembrada fica, para a entrada continuar com a cara da conta. */
export async function logout(): Promise<void> {
  const token = await readCookie(APP_COOKIE)
  if (token) await logoutUser(token)
  await clearSessionCookie(APP_COOKIE)
  redirect('/entrar')
}

/** Encerra o modo suporte: apaga a sessão de suporte e o cookie, grava o fim na auditoria e volta ao painel dev. */
export async function encerrarSuporte(): Promise<void> {
  const token = await readCookie(APP_COOKIE)
  if (token) await endSupport(token)
  await clearSessionCookie(APP_COOKIE)
  redirect(areaLink('dev', '/'))
}
