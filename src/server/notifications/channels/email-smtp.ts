import 'server-only'
import nodemailer from 'nodemailer'
import { assertSafeRecipient, fromHeader, type EmailChannel } from './types'

/** Canal de produção: SMTP por `SMTP_URL` (a conexão só abre no primeiro envio). */
export function createSmtpChannel(smtpUrl: string, from: string): EmailChannel {
  const transport = nodemailer.createTransport(smtpUrl)
  return {
    async send(msg) {
      assertSafeRecipient(msg.to)
      await transport.sendMail({ from: msg.fromName === undefined ? from : fromHeader(from, msg.fromName), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    },
  }
}
