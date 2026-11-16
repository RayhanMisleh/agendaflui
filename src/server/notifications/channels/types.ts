export type EmailMessage = { to: string; subject: string; text: string; html: string }

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
