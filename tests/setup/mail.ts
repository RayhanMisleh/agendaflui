import { setEmailChannel } from '@/server/notifications/channels'
import type { EmailChannel, EmailMessage } from '@/server/notifications/channels/types'

export type FakeMail = {
  sent: EmailMessage[]
  /** Quando verdadeiro, o próximo envio e os seguintes falham até `failing = false`. */
  failing: boolean
  /** Mensagens cujo envio falhou (o erro lançado cita o corpo e o destinatário, para provar que o log não os repete). */
  failed: EmailMessage[]
  channel: EmailChannel
  /** O código de 6 dígitos do e-mail `index` (o último por padrão). */
  codeOf: (index?: number) => string
  /** O código de 6 dígitos da primeira mensagem que falhou no envio. */
  codeOfFailed: () => string
  /** Esvazia a caixa e instala o canal falso; chame no `beforeEach`. */
  install: () => void
  /** Remove o canal falso; chame no `afterEach`. */
  uninstall: () => void
}

/** Canal de e-mail falso para os testes: guarda as mensagens em `sent`. */
export function fakeMail(): FakeMail {
  const sent: EmailMessage[] = []
  const failed: EmailMessage[] = []
  const mail: FakeMail = {
    sent,
    failed,
    failing: false,
    channel: {
      async send(msg) {
        if (mail.failing) {
          failed.push(msg)
          throw new Error(`Falha de envio simulada para ${msg.to}: ${msg.text}`)
        }
        sent.push(msg)
      },
    },
    codeOf(index = sent.length - 1) {
      const msg = sent[index]
      if (!msg) throw new Error(`Não há e-mail número ${index}.`)
      const m = /\b(\d{6})\b/.exec(msg.text)
      if (!m?.[1]) throw new Error('O e-mail não traz um código de 6 dígitos.')
      return m[1]
    },
    codeOfFailed() {
      const m = /\b(\d{6})\b/.exec(failed[0]?.text ?? '')
      if (!m?.[1]) throw new Error('Nenhuma mensagem com código falhou.')
      return m[1]
    },
    install() {
      sent.length = 0
      failed.length = 0
      mail.failing = false
      setEmailChannel(mail.channel)
    },
    uninstall() {
      setEmailChannel(undefined)
    },
  }
  return mail
}
