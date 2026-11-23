import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { emailChannelKind, getChannels, getEmailChannel, setEmailChannel } from '@/server/notifications/channels'
import { createFileChannel } from '@/server/notifications/channels/email-file'
import { createSmtpChannel } from '@/server/notifications/channels/email-smtp'
import { maskEmail } from '@/server/notifications/channels/types'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'agendaflui-mail-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  setEmailChannel(undefined)
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const msg = { to: 'maria@exemplo.test', subject: 'Seu código é válido: ção', text: 'Código 123456', html: '<p>Código 123456</p>' }

describe('canal de arquivo', () => {
  test('grava um .eml com cabeçalhos, assunto codificado e as duas partes', async () => {
    const dir = join(tmp(), 'nova-pasta')
    await createFileChannel(dir, 'Agenda Flui <nao-responda@agendaflui.localhost>').send(msg)
    const arquivos = readdirSync(dir)
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0]).toMatch(/\.eml$/)
    const eml = readFileSync(join(dir, arquivos[0] ?? ''), 'utf8')
    expect(eml).toContain('To: maria@exemplo.test')
    expect(eml).toContain('From: Agenda Flui <nao-responda@agendaflui.localhost>')
    expect(eml).toMatch(/^Subject: =\?UTF-8\?B\?/m)
    expect(eml).toContain('multipart/alternative')
    expect(eml).toContain('text/plain; charset=utf-8')
    expect(eml).toContain('text/html; charset=utf-8')
    expect(Buffer.from(eml.split('Content-Transfer-Encoding: base64')[1]?.split('--')[0]?.replace(/\s/g, '') ?? '', 'base64').toString('utf8')).toBe(msg.text)
  })

  test('recusa destinatário que não é um único endereço seguro', async () => {
    const dir = tmp()
    const canal = createFileChannel(dir, 'a@b.test')
    for (const to of ['a@b.test,c@d.test', 'a@b.test\r\nBcc: x@y.test', 'Fulano <a@b.test>', '', 'a b@c.test']) {
      await expect(canal.send({ ...msg, to })).rejects.toThrow()
    }
    expect(readdirSync(dir)).toHaveLength(0)
  })
})

describe('canal SMTP', () => {
  test('o transporte tem tempos limite de no máximo 20 s', async () => {
    const nodemailer = (await import('nodemailer')).default
    const espiao = vi.spyOn(nodemailer, 'createTransport')
    try {
      createSmtpChannel('smtp://localhost:2525', 'a@b.test')
      const opcoes = espiao.mock.calls[0]?.[1] as Record<string, number> | undefined
      for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
        expect(opcoes?.[k]).toBeGreaterThan(0)
        expect(opcoes?.[k]).toBeLessThanOrEqual(20_000)
      }
    } finally {
      espiao.mockRestore()
    }
  })

  test('cria o canal sem conectar e também recusa destinatário inseguro', async () => {
    const canal = createSmtpChannel('smtp://localhost:2525', 'a@b.test')
    await expect(canal.send({ ...msg, to: 'a@b.test,c@d.test' })).rejects.toThrow()
  })
})

describe('getEmailChannel', () => {
  test('teste: nenhum canal real; o injetado vale', async () => {
    expect(getEmailChannel({ NODE_ENV: 'test', SMTP_URL: 'smtp://x' })).toBeNull()
    const falso = { async send() {} }
    setEmailChannel(falso)
    expect(getEmailChannel({ NODE_ENV: 'production', SMTP_URL: undefined })).toBe(falso)
    setEmailChannel(null)
    expect(getEmailChannel({ NODE_ENV: 'development', SMTP_URL: undefined })).toBeNull()
  })

  test('o canal SMTP é um só por processo (e setEmailChannel continua mandando)', () => {
    const prod = { NODE_ENV: 'production', SMTP_URL: 'smtp://localhost:2525', MAIL_FROM: 'a@b.test' }
    expect(getEmailChannel(prod)).toBe(getEmailChannel(prod))
    const falso = { async send() {} }
    setEmailChannel(falso)
    expect(getEmailChannel(prod)).toBe(falso)
  })

  test('desenvolvimento usa arquivo; produção usa SMTP se configurado, senão nenhum', () => {
    expect(getEmailChannel({ NODE_ENV: 'development', SMTP_URL: undefined })).not.toBeNull()
    expect(getEmailChannel({ NODE_ENV: 'production', SMTP_URL: 'smtp://localhost:2525' })).not.toBeNull()
    expect(getEmailChannel({ NODE_ENV: 'production', SMTP_URL: undefined })).toBeNull()
  })
})

describe('maskEmail', () => {
  test('mostra só a primeira letra e o domínio', () => {
    expect(maskEmail('maria@exemplo.test')).toBe('m***@exemplo.test')
    expect(maskEmail('a@b.test')).toBe('a***@b.test')
    expect(maskEmail('sem-arroba')).toBe('***')
  })
})

describe('nome do remetente por conta', () => {
  test('fromName troca só o nome, mantém o endereço do remetente e nunca quebra o cabeçalho', async () => {
    const dir = tmp()
    await createFileChannel(dir, 'Agenda Flui <nao-responda@agendaflui.localhost>').send({ ...msg, fromName: 'Tosa & Cia\r\nBcc: x@y.test' })
    const eml = readFileSync(join(dir, readdirSync(dir)[0] ?? ''), 'utf8')
    const from = /^From: (.*)$/m.exec(eml)?.[1] ?? ''
    expect(from).toContain('<nao-responda@agendaflui.localhost>')
    expect(from).toContain('Tosa & Cia')
    expect(eml).not.toMatch(/^Bcc:/m)
  })
})

describe('getChannels', () => {
  test('em teste não há canal real; o e-mail injetado vale', () => {
    expect(getChannels({ NODE_ENV: 'test' })).toEqual({ email: null, push: null })
    const falso = { async send() {} }
    setEmailChannel(falso)
    expect(getChannels({ NODE_ENV: 'test' }).email).toBe(falso)
  })

  test('em desenvolvimento são os de arquivo; em produção o push é o Expo e o e-mail depende do SMTP', () => {
    const dev = getChannels({ NODE_ENV: 'development' })
    expect(dev.email).not.toBeNull()
    expect(dev.push).not.toBeNull()
    const prod = getChannels({ NODE_ENV: 'production', SMTP_URL: undefined })
    expect(prod.email).toBeNull()
    expect(prod.push).not.toBeNull()
    expect(getChannels({ NODE_ENV: 'production', SMTP_URL: 'smtp://localhost:2525' }).email).not.toBeNull()
  })
})

describe('canal de produção: Resend ou SMTP', () => {
  const base = { NODE_ENV: 'production', MAIL_FROM: 'a@b.test' }
  const SMTP = 'smtp://localhost:2525'
  const CHAVE = 'chave-so-de-teste'

  test('com RESEND_API_KEY usa o Resend; sem ela e com SMTP_URL, o SMTP; sem nenhum, nada', () => {
    expect(emailChannelKind({ ...base, RESEND_API_KEY: CHAVE, SMTP_URL: SMTP })).toBe('resend')
    expect(emailChannelKind({ ...base, SMTP_URL: SMTP })).toBe('smtp')
    expect(emailChannelKind({ ...base })).toBe('none')
    expect(getEmailChannel({ ...base, RESEND_API_KEY: CHAVE })).not.toBeNull()
    expect(getEmailChannel({ ...base })).toBeNull()
  })

  test('desenvolvimento usa arquivos e teste não tem canal próprio', () => {
    expect(emailChannelKind({ NODE_ENV: 'development' })).toBe('file')
    expect(emailChannelKind({ NODE_ENV: 'test', RESEND_API_KEY: CHAVE })).toBe('none')
  })

  test('canal injetado conta como "file"; injetar null conta como "none"', () => {
    setEmailChannel({ async send() {} })
    expect(emailChannelKind({ ...base, RESEND_API_KEY: CHAVE })).toBe('file')
    setEmailChannel(null)
    expect(emailChannelKind({ ...base, RESEND_API_KEY: CHAVE })).toBe('none')
  })
})
