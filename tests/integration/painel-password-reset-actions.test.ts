import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setAfterScheduler } from '@/server/api/after'
import { verifyPassword } from '@/server/auth/password'
import { RESET_INVALID_MESSAGE, requestPanelPasswordReset } from '@/server/auth/password-reset'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.9' }) }))

import { esqueciASenha } from '@/app/painel/esqueci-a-senha/actions'
import { redefinirSenha } from '@/app/painel/redefinir-senha/[token]/actions'

const mail = fakeMail()
const MENSAGEM = 'Se houver uma conta com este e-mail, enviamos as instruções.'
const ini = { ok: false, message: null, fields: {}, values: {} } as never

let tarefas: (() => Promise<void>)[]
beforeEach(async () => {
  await resetDb()
  mail.install()
  tarefas = []
  setAfterScheduler((t) => {
    tarefas.push(t)
  })
})
afterEach(() => {
  mail.uninstall()
  setAfterScheduler(undefined)
})

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}
async function rodarDepois(): Promise<void> {
  for (const t of tarefas) await t()
}

async function pessoa() {
  const b = await makeBusiness()
  const user = await makeUser({ password: 'senha-antiga-1' })
  await makeMembership(b.id, user.id, 'OWNER')
  return user
}

describe('esqueci a senha', () => {
  test('e-mail existente e inexistente recebem exatamente o mesmo estado, e só o existente recebe e-mail', async () => {
    const user = await pessoa()
    const a = await esqueciASenha(ini, form({ email: user.email }))
    const b = await esqueciASenha(ini, form({ email: 'ninguem@exemplo.test' }))
    expect(a).toEqual({ ...b, values: { email: user.email } })
    expect(a.ok).toBe(true)
    expect(a.message).toBe(MENSAGEM)
    expect(mail.sent).toHaveLength(0)
    await rodarDepois()
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.to).toBe(user.email)
  })

  test('e-mail mal formado vira erro no campo, igual para qualquer caso', async () => {
    const r = await esqueciASenha(ini, form({ email: 'sem-arroba' }))
    expect(r.ok).toBe(false)
    expect(r.fields.email).toBeTruthy()
    expect(tarefas).toHaveLength(0)
  })
})

describe('redefinir a senha', () => {
  async function comLink() {
    const user = await pessoa()
    await (await requestPanelPasswordReset(user.email, { ip: '198.51.100.4' }, new Date()))()
    const token = /\/redefinir-senha\/([A-Za-z0-9_-]+)/.exec(mail.sent[0]?.text ?? '')?.[1] ?? ''
    return { user, token }
  }

  test('com o link, troca a senha e manda para a entrada; link usado de novo diz que não vale mais', async () => {
    const { user, token } = await comLink()
    await expect(redefinirSenha(ini, form({ token, password: 'senha-nova-123', confirm: 'senha-nova-123' }))).rejects.toMatchObject({
      digest: expect.stringContaining('/entrar'),
    })
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash
    expect(await verifyPassword(hash ?? '', 'senha-nova-123')).toBe(true)
    const outra = await redefinirSenha(ini, form({ token, password: 'outra-senha-123', confirm: 'outra-senha-123' }))
    expect(outra.ok).toBe(false)
    expect(outra.message).toBe(RESET_INVALID_MESSAGE)
  })

  test('senhas diferentes voltam no campo de confirmação, sem gastar o link', async () => {
    const { token } = await comLink()
    const r = await redefinirSenha(ini, form({ token, password: 'senha-nova-123', confirm: 'senha-nova-124' }))
    expect(r.ok).toBe(false)
    expect(r.fields.confirm).toBeTruthy()
    expect(JSON.stringify(r.values)).not.toContain('senha-nova')
    await expect(redefinirSenha(ini, form({ token, password: 'senha-nova-123', confirm: 'senha-nova-123' }))).rejects.toBeTruthy()
  })

  test('token inexistente devolve a mensagem de link inválido', async () => {
    const r = await redefinirSenha(ini, form({ token: 'nao-existe', password: 'senha-nova-123', confirm: 'senha-nova-123' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(RESET_INVALID_MESSAGE)
  })

  test('senha curta volta como erro de campo', async () => {
    const { token } = await comLink()
    const r = await redefinirSenha(ini, form({ token, password: 'curta', confirm: 'curta' }))
    expect(r.ok).toBe(false)
    expect(r.fields.password).toBeTruthy()
  })
})
