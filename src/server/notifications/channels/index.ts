import 'server-only'
import { env } from '@/server/env'
import { createFileChannel, MAIL_DIR } from './email-file'
import { createSmtpChannel } from './email-smtp'
import type { EmailChannel } from './types'

type ChannelEnv = { NODE_ENV: string; SMTP_URL?: string | undefined; MAIL_FROM?: string | undefined }

// `undefined`: sem substituição (vale a regra do ambiente); `null`: força "nenhum canal"; canal: vale esse.
let injected: EmailChannel | null | undefined

/**
 * Ponto de injeção explícito: os testes instalam um canal falso (ou `null` para simular ausência) e chamam
 * `setEmailChannel(undefined)` ao terminar. Não é usado em código de produção.
 */
export function setEmailChannel(channel: EmailChannel | null | undefined): void {
  injected = channel
}

/**
 * Canal de e-mail do ambiente. Teste: nenhum (só o injetado). Desenvolvimento: arquivos em `.local/mail`.
 * Produção: SMTP se `SMTP_URL` estiver definida; senão `null` (quem envia registra e segue).
 */
export function getEmailChannel(source: ChannelEnv = env): EmailChannel | null {
  if (injected !== undefined) return injected
  const from = source.MAIL_FROM ?? env.MAIL_FROM
  if (source.NODE_ENV === 'test') return null
  if (source.NODE_ENV === 'development') return createFileChannel(MAIL_DIR, from)
  return source.SMTP_URL ? createSmtpChannel(source.SMTP_URL, from) : null
}
