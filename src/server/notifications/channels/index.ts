import 'server-only'
import { DEFAULT_MAIL_FROM, env } from '@/server/env'
import { createFileChannel, MAIL_DIR } from './email-file'
import { createResendChannel } from './email-resend'
import { createSmtpChannel } from './email-smtp'
import type { EmailChannel } from './types'

type ChannelEnv = {
  NODE_ENV: string
  SMTP_URL?: string | undefined
  RESEND_API_KEY?: string | undefined
  MAIL_FROM?: string | undefined
}

// `undefined`: sem substituição (vale a regra do ambiente); `null`: força "nenhum canal"; canal: vale esse.
let injected: EmailChannel | null | undefined
// Um transporte SMTP por processo (por URL e remetente) e um canal Resend (por chave e remetente).
let smtp: { url: string; from: string; channel: EmailChannel } | undefined
let resend: { key: string; from: string; channel: EmailChannel } | undefined

/**
 * Ponto de injeção explícito: os testes instalam um canal falso (ou `null` para simular ausência) e chamam
 * `setEmailChannel(undefined)` ao terminar. Não é usado em código de produção.
 */
export function setEmailChannel(channel: EmailChannel | null | undefined): void {
  injected = channel
}

export type EmailChannelKind = 'resend' | 'smtp' | 'file' | 'none'

/**
 * Qual canal de e-mail vale agora (para mostrar na tela e na auditoria). Canal injetado por teste conta como `file`;
 * `null` injetado, como `none`.
 */
export function emailChannelKind(source: ChannelEnv = env): EmailChannelKind {
  if (injected === null) return 'none'
  if (injected !== undefined) return 'file'
  if (source.NODE_ENV === 'test') return 'none'
  if (source.NODE_ENV === 'development') return 'file'
  if (source.RESEND_API_KEY) return 'resend'
  return source.SMTP_URL ? 'smtp' : 'none'
}

/**
 * Canal de e-mail do ambiente. Teste: nenhum (só o injetado). Desenvolvimento: arquivos em `.local/mail`.
 * Produção: Resend se `RESEND_API_KEY` estiver definida; senão SMTP se `SMTP_URL` estiver definida; senão `null` (quem
 * envia registra e segue).
 */
export function getEmailChannel(source: ChannelEnv = env): EmailChannel | null {
  if (injected !== undefined) return injected
  const from = source.MAIL_FROM ?? env.MAIL_FROM ?? DEFAULT_MAIL_FROM
  const kind = emailChannelKind(source)
  if (kind === 'file') return createFileChannel(MAIL_DIR, from)
  if (kind === 'resend' && source.RESEND_API_KEY) {
    const key = source.RESEND_API_KEY
    if (resend?.key !== key || resend.from !== from) resend = { key, from, channel: createResendChannel(key, from) }
    return resend.channel
  }
  const url = source.SMTP_URL
  if (kind !== 'smtp' || !url) return null
  if (smtp?.url !== url || smtp.from !== from) smtp = { url, from, channel: createSmtpChannel(url, from) }
  return smtp.channel
}

export type Channels = { email: EmailChannel | null }

/** Os canais do ambiente. `null` = não configurado (quem envia falha a linha com `not_configured`). */
export function getChannels(source: ChannelEnv = env): Channels {
  return { email: getEmailChannel(source) }
}
