import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { verifyPassword } from '@/server/auth/password'
import { generateToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { createApiKey } from '@/server/domain/platform/api-keys'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn(), readCookie: vi.fn(), DEV_COOKIE: 'af_dev_session' }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { criarAdmin, desativarAdmin, reativarAdmin } from '@/app/dev/(app)/admins/actions'
import { criarChavePlataforma, revogarChave } from '@/app/dev/(app)/chaves/actions'
import { salvarPerfil, trocarSenha } from '@/app/dev/(app)/perfil/actions'
import { tentarDeNovo } from '@/app/dev/(app)/sistema/actions'
import type { FormState } from '@/app/_lib/form-state'

const ini = { ok: false, message: null, fields: {}, values: {} } as FormState<Record<string, never>> as never

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let eu: { id: string; name: string; email: string }
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin({ password: 'senha-atual-longa' })
  eu = { id: admin.id, name: admin.name, email: admin.email }
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: admin.id, name: admin.name })
})
afterEach(() => {
  guards.requirePlatformAdmin.mockReset()
  guards.readCookie.mockReset()
})

describe('toda ação confere o admin antes de agir', () => {
  test('sem sessão válida a ação não chega a gravar nada', async () => {
    guards.requirePlatformAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarChavePlataforma(ini, form({ name: 'Painel externo', origins: '' }))).rejects.toThrow('NEXT_REDIRECT')
    await expect(criarAdmin(ini, form({ name: 'Ana', email: 'ana@exemplo.test', senha: 'uma-senha-bem-longa' }))).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.apiKey.count()).toBe(0)
    expect(await prisma.platformAdmin.count()).toBe(1)
  })
})

describe('chaves de plataforma', () => {
  test('criar devolve o segredo uma vez, audita sem o segredo e não o guarda em claro', async () => {
    const r = await criarChavePlataforma(ini, form({ name: 'Painel externo', origins: 'https://app.exemplo.com\n' }))
    expect(r.ok).toBe(true)
    expect(r.values.secret).toMatch(/^afk_p_/)
    const chave = await prisma.apiKey.findFirstOrThrow()
    expect(chave.kind).toBe('PLATFORM')
    expect(chave.businessId).toBeNull()
    expect(chave.allowedOrigins).toEqual(['https://app.exemplo.com'])
    const auditoria = JSON.stringify(await prisma.auditLog.findMany({ where: { action: 'api_key.created' } }))
    expect(auditoria).not.toContain(r.values.secret)
    expect(JSON.stringify(chave)).not.toContain(r.values.secret)
  })

  test('nome vazio volta como erro do campo, com o que foi digitado', async () => {
    const r = await criarChavePlataforma(ini, form({ name: '   ', origins: 'https://a.exemplo.com' }))
    expect(r.ok).toBe(false)
    expect(r.fields.name).toBeTruthy()
    expect(r.values.origins).toBe('https://a.exemplo.com')
    expect(await prisma.apiKey.count()).toBe(0)
  })

  test('revogar pede o nome exato: sem ele nada muda; com ele revoga e audita', async () => {
    const { key } = await createApiKey({ kind: 'platform_admin', adminId: eu.id, name: eu.name }, { kind: 'PLATFORM', name: 'Painel externo' })
    const errada = await revogarChave(key.id, ini, form({ confirmName: 'outro nome' }))
    expect(errada.ok).toBe(false)
    expect(errada.fields.confirmName).toBeTruthy()
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toBeNull()

    const certa = await revogarChave(key.id, ini, form({ confirmName: 'Painel externo' }))
    expect(certa.ok).toBe(true)
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'api_key.revoked', targetId: key.id, actorId: eu.id } })).toBe(1)
  })

  test('id de chave que não existe devolve mensagem, não erro 500', async () => {
    const r = await revogarChave('00000000-0000-4000-8000-000000000000', ini, form({ confirmName: 'x' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/não encontrada/i)
  })
})

describe('admins', () => {
  test('criar com e-mail repetido devolve o erro no campo e nunca devolve a senha', async () => {
    const r = await criarAdmin(ini, form({ name: 'Outra pessoa', email: eu.email, senha: 'uma-senha-bem-longa' }))
    expect(r.ok).toBe(false)
    expect(r.fields.email).toMatch(/já existe/i)
    expect(JSON.stringify(r)).not.toContain('uma-senha-bem-longa')
    expect(r.values.name).toBe('Outra pessoa')
  })

  test('criar com sucesso grava, audita e devolve o formulário limpo, sem senha', async () => {
    const r = await criarAdmin(ini, form({ name: 'Ana Souza', email: 'ana@exemplo.test', senha: 'uma-senha-bem-longa' }))
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain('uma-senha-bem-longa')
    expect(await prisma.platformAdmin.count({ where: { email: 'ana@exemplo.test' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'admin.created' } })).toBe(1)
  })

  test('senha curta vira erro no campo "senha"', async () => {
    const r = await criarAdmin(ini, form({ name: 'Ana', email: 'ana2@exemplo.test', senha: 'curta' }))
    expect(r.ok).toBe(false)
    expect(r.fields.senha).toBeTruthy()
  })

  test('desativar a si mesmo devolve a mensagem do domínio e nada muda', async () => {
    const r = await desativarAdmin(eu.id, ini, form({ confirmName: eu.name }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/próprio acesso/i)
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: eu.id } })).active).toBe(true)
  })

  test('desativar outro pede o nome; depois reativar volta o acesso', async () => {
    const outro = await makePlatformAdmin({ name: 'Bruno Lima' })
    const sem = await desativarAdmin(outro.id, ini, form({ confirmName: 'Bruno' }))
    expect(sem.ok).toBe(false)
    expect(sem.fields.confirmName).toBeTruthy()
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: outro.id } })).active).toBe(true)

    expect((await desativarAdmin(outro.id, ini, form({ confirmName: 'Bruno Lima' }))).ok).toBe(true)
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: outro.id } })).active).toBe(false)
    expect((await reativarAdmin(outro.id, ini, form({}))).ok).toBe(true)
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: outro.id } })).active).toBe(true)
  })
})

describe('perfil', () => {
  test('salvar o nome atualiza e audita; nome vazio é erro do campo', async () => {
    const ruim = await salvarPerfil(ini, form({ name: ' ' }))
    expect(ruim.ok).toBe(false)
    expect(ruim.fields.name).toBeTruthy()
    const ok = await salvarPerfil(ini, form({ name: 'Nome Novo' }))
    expect(ok.ok).toBe(true)
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: eu.id } })).name).toBe('Nome Novo')
  })

  async function sessao() {
    const atual = generateToken()
    const outra = generateToken()
    const expira = addMinutes(new Date(), 30)
    await prisma.platformSession.create({ data: { adminId: eu.id, tokenHash: atual.hash, expiresAt: expira } })
    await prisma.platformSession.create({ data: { adminId: eu.id, tokenHash: outra.hash, expiresAt: expira } })
    guards.readCookie.mockResolvedValue(atual.token)
    return { atual, outra }
  }

  test('senha atual errada devolve erro no campo e não troca a senha', async () => {
    await sessao()
    const antes = (await prisma.platformAdmin.findUniqueOrThrow({ where: { id: eu.id } })).passwordHash
    const r = await trocarSenha(ini, form({ senhaAtual: 'errada-errada', senhaNova: 'nova-senha-bem-longa', senhaRepetida: 'nova-senha-bem-longa' }))
    expect(r.ok).toBe(false)
    expect(r.fields.senhaAtual).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain('nova-senha-bem-longa')
    expect(JSON.stringify(r)).not.toContain('errada-errada')
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: eu.id } })).passwordHash).toBe(antes)
  })

  test('repetição diferente é erro do campo e não troca nada', async () => {
    await sessao()
    const r = await trocarSenha(ini, form({ senhaAtual: 'senha-atual-longa', senhaNova: 'nova-senha-bem-longa', senhaRepetida: 'outra-coisa-bem-longa' }))
    expect(r.ok).toBe(false)
    expect(r.fields.senhaRepetida).toBeTruthy()
  })

  test('trocar a senha mantém a sessão atual (token do cookie, não do formulário) e revoga as outras', async () => {
    const { atual, outra } = await sessao()
    const r = await trocarSenha(
      ini,
      form({ senhaAtual: 'senha-atual-longa', senhaNova: 'nova-senha-bem-longa', senhaRepetida: 'nova-senha-bem-longa', token: outra.token }),
    )
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain('nova-senha-bem-longa')
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: eu.id } })
    expect(await verifyPassword(admin.passwordHash, 'nova-senha-bem-longa')).toBe(true)
    expect((await prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: atual.hash } })).revokedAt).toBeNull()
    expect((await prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: outra.hash } })).revokedAt).not.toBeNull()
  })
})

describe('sistema: tentar de novo', () => {
  async function aviso(status: 'FAILED' | 'PENDING') {
    const conta = await makeBusiness()
    const cliente = await makeCustomer(conta.id)
    return prisma.notification.create({
      data: {
        businessId: conta.id,
        kind: 'APPOINTMENT_CONFIRMED',
        channel: 'EMAIL',
        customerId: cliente.id,
        scheduledFor: addMinutes(new Date(), -5),
        status,
        attempts: status === 'FAILED' ? 5 : 0,
        ...(status === 'FAILED' ? { lastError: 'timeout' } : {}),
        payload: {},
        dedupeKey: `k-${status}-${Math.random()}`,
      },
    })
  }

  test('aviso em falha volta para a fila e audita', async () => {
    const n = await aviso('FAILED')
    const r = await tentarDeNovo(n.id, ini, form({}))
    expect(r.ok).toBe(true)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('PENDING')
    expect(await prisma.auditLog.count({ where: { action: 'notification.retried', targetId: n.id } })).toBe(1)
  })

  test('aviso que não está em falha devolve a mensagem de conflito do domínio', async () => {
    const n = await aviso('PENDING')
    const r = await tentarDeNovo(n.id, ini, form({}))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/não está com falha/i)
  })

  test('id que não é de aviso nenhum vira mensagem', async () => {
    const r = await tentarDeNovo('00000000-0000-4000-8000-000000000000', ini, form({}))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/não encontrado/i)
  })
})
