'use server'
import { redirect } from 'next/navigation'
import { clearSessionCookie, DEV_COOKIE, readCookie } from '@/server/auth/guards'
import { logoutPlatform } from '@/server/auth/platform-auth'

/** Revoga a sessão no banco e apaga o cookie. */
export async function logoutAdmin(): Promise<void> {
  const token = await readCookie(DEV_COOKIE)
  if (token) await logoutPlatform(token)
  await clearSessionCookie(DEV_COOKIE)
  redirect('/entrar')
}
