import 'server-only'
import nodemailer from 'nodemailer'
import { assertSafeRecipient, fromHeader, type EmailChannel } from './types'

/** Canal de produção: SMTP por `SMTP_URL` (a conexão só abre no primeiro envio). */
export function createSmtpChannel(smtpUrl: string, from: string): EmailChannel {
  const transport = nodemailer.createTransport(smtpUrl, {
    // Abaixo do teto de 30 s do envio na rodada: o envio não continua vivo depois que a rodada desistiu dele.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
  return {
    async send(msg) {
      assertSafeRecipient(msg.to)
      await transport.sendMail({ from: msg.fromName === undefined ? from : fromHeader(from, msg.fromName), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    },
  }
}
