'use server'
import { redirect } from 'next/navigation'
import { clearSessionCookie, PAINEL_COOKIE, readCookie } from '@/server/auth/guards'
import { logoutUser } from '@/server/auth/member-auth'

/** Revoga a sessão no banco e apaga o cookie. A marca lembrada fica, para a entrada continuar com a cara da conta. */
export async function logout(): Promise<void> {
  const token = await readCookie(PAINEL_COOKIE)
  if (token) await logoutUser(token)
  await clearSessionCookie(PAINEL_COOKIE)
  redirect('/entrar')
}
