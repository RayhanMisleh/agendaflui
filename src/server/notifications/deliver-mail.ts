import 'server-only'
import { getEmailChannel } from './channels'
import { isSafeRecipient, maskEmail } from './channels/types'
import type { RenderedMail } from './render-account'

/**
 * Envia um e-mail de acesso (convite, aviso de acesso, redefinição de senha) depois do commit. Falha ou falta de canal não
 * desfaz nada: só vai para o log, com o tipo, o e-mail mascarado e o nome do erro (nunca o corpo, o link nem a mensagem).
 * Devolve `true` só se o canal aceitou o e-mail.
 */
export async function deliverAccessMail(kind: string, to: string, mail: RenderedMail): Promise<boolean> {
  const channel = getEmailChannel()
  if (!channel || !isSafeRecipient(to)) {
    console.warn(JSON.stringify({ level: 'warn', event: 'access_mail_skipped', kind, to: maskEmail(to) }))
    return false
  }
  try {
    await channel.send({ to, fromName: 'Agenda Flui', ...mail })
    return true
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', event: 'access_mail_failed', kind, to: maskEmail(to), error: err instanceof Error ? err.name : 'unknown' }),
    )
    return false
  }
}
