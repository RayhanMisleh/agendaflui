import { describe, expect, test, vi } from 'vitest'
import { createResendChannel } from '@/server/notifications/channels/email-resend'
import { ChannelError } from '@/server/notifications/channels/types'

const msg = { to: 'maria@exemplo.test', subject: 'Assunto: ção', text: 'Texto', html: '<p>Texto</p>' }
const CHAVE = 'chave-so-de-teste'

function respostaFalsa(status: number, corpo = '{}') {
  const fetchFalso = vi.fn<typeof fetch>(async () => new Response(corpo, { status }))
  return fetchFalso
}

describe('canal Resend', () => {
  test('manda o JSON certo com Bearer e o remetente de MAIL_FROM', async () => {
    const f = respostaFalsa(200, '{"id":"x"}')
    await createResendChannel(CHAVE, 'Agenda Flui <contato@exemplo.com>', f).send({ ...msg, fromName: 'Patas Felizes' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] ?? []
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    const cab = new Headers(init?.headers)
    expect(cab.get('authorization')).toBe(`Bearer ${CHAVE}`)
    expect(cab.get('content-type')).toMatch(/application\/json/)
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Patas Felizes <contato@exemplo.com>',
      to: ['maria@exemplo.test'],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test('sem fromName usa o remetente de MAIL_FROM como veio', async () => {
    const f = respostaFalsa(200)
    await createResendChannel(CHAVE, 'Agenda Flui <contato@exemplo.com>', f).send(msg)
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).from).toBe('Agenda Flui <contato@exemplo.com>')
  })

  test('4xx e 5xx viram ChannelError channel_error sem o corpo da resposta', async () => {
    for (const status of [401, 422, 429, 500]) {
      const f = respostaFalsa(status, '{"message":"maria@exemplo.test recusado, chave-so-de-teste"}')
      const erro = await createResendChannel(CHAVE, 'a@b.test', f).send(msg).then(() => null, (e: unknown) => e)
      expect(erro, String(status)).toBeInstanceOf(ChannelError)
      expect((erro as ChannelError).code).toBe('channel_error')
      expect((erro as ChannelError).message).not.toMatch(/maria|chave/)
    }
  })

  test('falha de rede vira channel_error e tempo esgotado vira timeout', async () => {
    const rede = vi.fn(async () => {
      throw new TypeError('fetch failed para maria@exemplo.test')
    })
    const e1 = await createResendChannel(CHAVE, 'a@b.test', rede).send(msg).then(() => null, (e: unknown) => e)
    expect((e1 as ChannelError).code).toBe('channel_error')
    expect((e1 as ChannelError).message).not.toMatch(/maria/)
    const lento = vi.fn(async () => {
      throw new DOMException('expirou', 'TimeoutError')
    })
    const e2 = await createResendChannel(CHAVE, 'a@b.test', lento).send(msg).then(() => null, (e: unknown) => e)
    expect((e2 as ChannelError).code).toBe('timeout')
  })

  test('recusa destinatário inseguro sem chamar a rede', async () => {
    const f = respostaFalsa(200)
    await expect(createResendChannel(CHAVE, 'a@b.test', f).send({ ...msg, to: 'a@b.test,c@d.test' })).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
})
