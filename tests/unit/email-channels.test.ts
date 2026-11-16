import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getEmailChannel, setEmailChannel } from '@/server/notifications/channels'
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
    await createFileChannel(dir, 'AgendaFlui <nao-responda@agendaflui.localhost>').send(msg)
    const arquivos = readdirSync(dir)
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0]).toMatch(/\.eml$/)
    const eml = readFileSync(join(dir, arquivos[0] ?? ''), 'utf8')
    expect(eml).toContain('To: maria@exemplo.test')
    expect(eml).toContain('From: AgendaFlui <nao-responda@agendaflui.localhost>')
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
