import 'server-only'
import { DEFAULT_MAIL_FROM, env } from '@/server/env'
import { createExpoChannel } from './push-expo'
import { createPushFileChannel, PUSH_DIR } from './push-file'
import { createFileChannel, MAIL_DIR } from './email-file'
import { createSmtpChannel } from './email-smtp'
import type { EmailChannel, PushChannel } from './types'

type ChannelEnv = {
  NODE_ENV: string
  SMTP_URL?: string | undefined
  MAIL_FROM?: string | undefined
  EXPO_ACCESS_TOKEN?: string | undefined
}

// `undefined`: sem substituição (vale a regra do ambiente); `null`: força "nenhum canal"; canal: vale esse.
let injected: EmailChannel | null | undefined
// Um transporte SMTP por processo (por URL e remetente).
let smtp: { url: string; from: string; channel: EmailChannel } | undefined

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
  const from = source.MAIL_FROM ?? env.MAIL_FROM ?? DEFAULT_MAIL_FROM
  if (source.NODE_ENV === 'test') return null
  if (source.NODE_ENV === 'development') return createFileChannel(MAIL_DIR, from)
  const url = source.SMTP_URL
  if (!url) return null
  if (smtp?.url !== url || smtp.from !== from) smtp = { url, from, channel: createSmtpChannel(url, from) }
  return smtp.channel
}

let pushFile: PushChannel | undefined
let expo: { token: string | undefined; channel: PushChannel } | undefined

/** Canal de push do ambiente. Teste: nenhum. Desenvolvimento: JSON em `.local/push`. Produção: Expo. */
export function getPushChannel(source: ChannelEnv = env): PushChannel | null {
  if (source.NODE_ENV === 'test') return null
  if (source.NODE_ENV === 'development') return (pushFile ??= createPushFileChannel(PUSH_DIR))
  if (expo?.token !== source.EXPO_ACCESS_TOKEN || expo === undefined) {
    expo = { token: source.EXPO_ACCESS_TOKEN, channel: createExpoChannel({ accessToken: source.EXPO_ACCESS_TOKEN }) }
  }
  return expo.channel
}

export type Channels = { email: EmailChannel | null; push: PushChannel | null }

/** Os dois canais do ambiente. `null` = não configurado (quem envia falha a linha com `not_configured`). */
export function getChannels(source: ChannelEnv = env): Channels {
  return { email: getEmailChannel(source), push: getPushChannel(source) }
}
