import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeRecipient, type EmailChannel, type EmailMessage } from './types'

/** Pasta dos e-mails de desenvolvimento (fica dentro de `.local`, que o Git ignora). */
export const MAIL_DIR = '.local/mail'

const base64 = (texto: string): string => (Buffer.from(texto, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')

/** Texto de cabeçalho: só ASCII puro passa direto; o resto vai em base64 (RFC 2047). Sem quebra de linha em hipótese alguma. */
function headerText(texto: string): string {
  const limpo = texto.replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(limpo) ? limpo : `=?UTF-8?B?${Buffer.from(limpo, 'utf8').toString('base64')}?=`
}

/** Monta a mensagem MIME (multipart/alternative com texto e HTML). */
export function buildEml(msg: EmailMessage, from: string, boundary: string): string {
  return [
    `From: ${from.replace(/[\r\n]+/g, ' ')}`,
    `To: ${msg.to}`,
    `Subject: ${headerText(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(msg.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(msg.html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/** Canal de desenvolvimento: grava cada e-mail como um arquivo `.eml` na pasta (criada se não existir). */
export function createFileChannel(dir: string, from: string): EmailChannel {
  return {
    async send(msg) {
      assertSafeRecipient(msg.to)
      await mkdir(dir, { recursive: true })
      const id = randomUUID()
      await writeFile(join(dir, `${Date.now()}-${id.slice(0, 8)}.eml`), buildEml(msg, from, `agendaflui-${id}`), 'utf8')
    },
  }
}
