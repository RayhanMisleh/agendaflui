'use server'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { CALENDAR_SCOPE } from '@/server/calendar/event'
import { GOOGLE_FLOW_COOKIE, readGoogleFlow } from '@/server/auth/google/flow'
import { normalizeEmail } from '@/server/domain/customers/contact'
import { env } from '@/server/env'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'

/** Estado do formulário: um erro geral e/ou o erro de cada campo. */
export type FalsoState = { error: string | null; fields: Record<string, string> }

function texto(form: FormData, nome: string, max: number): string {
  const v = form.get(nome)
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * Simula a tela do Google (só com `INTEGRATIONS_MODE=fake`): emite um código com a identidade digitada e volta ao retorno
 * com o `state` do fluxo. "Cancelar" volta com `error=access_denied`, como o Google faz.
 */
export async function simularGoogle(_anterior: FalsoState, form: FormData): Promise<FalsoState> {
  if (env.INTEGRATIONS_MODE !== 'fake') notFound()
  const fluxo = await readGoogleFlow((await cookies()).get(GOOGLE_FLOW_COOKIE)?.value, new Date())
  if (fluxo === null) return { error: 'O tempo para entrar com o Google acabou. Volte e tente de novo.', fields: {} }
  if (form.has('cancelar')) redirect(`/google/retorno?error=access_denied&state=${encodeURIComponent(fluxo.state)}`)
  let email: string
  try {
    email = normalizeEmail(texto(form, 'email', 254))
  } catch {
    return { error: null, fields: { email: 'Informe um e-mail válido, por exemplo nome@exemplo.com.' } }
  }
  const nome = texto(form, 'name', 120)
  const sub = texto(form, 'sub', 100) || `falso-${email}`
  const google = fakeGoogleAuthority()
  // Ligar a agenda: com a caixa marcada o "Google" devolve a permissão e um token de renovação novo, como o consentimento real.
  const daAgenda = fluxo.intent.kind === 'calendar' && form.has('agenda')
  const code = await google.issueCode(
    {
      sub,
      email,
      email_verified: form.has('verified'),
      nonce: fluxo.nonce,
      ...(nome !== '' ? { name: nome } : {}),
    },
    daAgenda ? { scope: `openid email ${CALENDAR_SCOPE}`, refreshToken: google.mintRefreshToken(sub) } : {},
  )
  redirect(`/google/retorno?code=${encodeURIComponent(code)}&state=${encodeURIComponent(fluxo.state)}`)
}
