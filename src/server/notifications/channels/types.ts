export type EmailMessage = {
  to: string
  /** Nome que aparece como remetente (o da conta); o endereço continua o de `MAIL_FROM`. */
  fromName?: string
  subject: string
  text: string
  html: string
}

/** Códigos curtos e fechados de falha de canal: é só o que vai para `lastError` (nunca a mensagem do provedor, que pode ter e-mail). */
export type ChannelErrorCode = 'not_configured' | 'channel_error' | 'timeout' | 'invalid_recipient' | 'internal_error'

export class ChannelError extends Error {
  constructor(readonly code: ChannelErrorCode) {
    super(code)
    this.name = 'ChannelError'
  }
}

/** Remetente com o nome da conta: `"Nome" <endereço de MAIL_FROM>`. Sem nome, devolve `from` como veio. */
export function fromHeader(from: string, fromName?: string): { name?: string; address: string } {
  const m = /<([^<>]+)>\s*$/.exec(from)
  const address = (m?.[1] ?? from).replace(/[\r\n]+/g, ' ').trim()
  const nameFromEnv = m ? from.slice(0, m.index).replace(/["\r\n]/g, ' ').trim() : ''
  const name = (fromName ?? nameFromEnv).replace(/[\u0000-\u001f\u007f"<>\\]+/g, ' ').trim()
  return name ? { name, address } : { address }
}

/** Canal de e-mail. Quem envia decide o que fazer com a falha (as rotas de conta a registram e seguem). */
export interface EmailChannel {
  send(msg: EmailMessage): Promise<void>
}

// Um único endereço simples: sem vírgula, aspas, colchetes, espaço nem quebra de linha (nada que abra outro destinatário ou cabeçalho).
const ENDERECO_SEGURO = /^[^\s@,;:<>()[\]"'\\]+@[^\s@,;:<>()[\]"'\\]+\.[^\s@,;:<>()[\]"'\\]+$/

/** `true` se `to` é um único endereço simples (nada que abra outro destinatário ou cabeçalho). */
export function isSafeRecipient(to: string): boolean {
  return typeof to === 'string' && to.length <= 254 && ENDERECO_SEGURO.test(to)
}

/** Lança se `to` não for um único endereço seguro. */
export function assertSafeRecipient(to: string): void {
  if (!isSafeRecipient(to)) throw new Error('Destinatário de e-mail inválido.')
}

/** `m***@exemplo.com`: o suficiente para reconhecer o domínio no log, sem expor o endereço. */
export function maskEmail(email: string): string {
  const arroba = email.lastIndexOf('@')
  if (arroba < 1) return '***'
  return `${email.slice(0, 1)}***@${email.slice(arroba + 1)}`
}
