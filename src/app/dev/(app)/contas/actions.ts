'use server'
import { redirect } from 'next/navigation'
import { startSupport } from '@/server/auth/support-session'
import { adminAction } from '../_lib/action'

/** "Entrar como": emite o link de passagem (60 s, uso único) e leva o admin ao painel da conta, em modo suporte. */
export const entrarComo = adminAction(
  (fd) => ({ businessId: String(fd.get('businessId') ?? '') }),
  (admin, v) => startSupport(admin, v.businessId),
  (r) => redirect(r.url),
)
