import { notFound, redirect } from 'next/navigation'
import { DomainError } from '@/server/domain/errors'
import { tenantAction } from '@/app/app/painel/_lib/action'
import type { FormState } from '@/app/_lib/form-state'
import type { TenantContext } from '@/server/auth/actor'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)

type V = { nome: string; senha?: string }
const vazio: FormState<V> = { ok: false, message: null, fields: {}, values: { nome: '' } }

function formulario(nome: string): FormData {
  const fd = new FormData()
  fd.set('nome', nome)
  return fd
}

function contexto(actor: TenantContext['actor']): TenantContext {
  return { businessId: 'b1', timeZone: 'America/Manaus', actor, clock: () => new Date(), channel: 'panel' } as unknown as TenantContext
}
const membro = (role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL') =>
  contexto({ kind: 'member', userId: 'u1', membershipId: 'm1', name: 'Ana', role })

const parse = (fd: FormData): V => ({ nome: String(fd.get('nome') ?? '') })
const done = (r: string, v: V): FormState<V> => ({ ok: true, message: r, fields: {}, values: v })

afterEach(() => {
  vi.restoreAllMocks()
  guards.requireTenant.mockReset()
})

test('sem sessão a ação não lê o formulário nem executa: o guarda redireciona', async () => {
  guards.requireTenant.mockRejectedValue(new Error('NEXT_REDIRECT'))
  const parseSpy = vi.fn(parse)
  const run = vi.fn()
  const acao = tenantAction('manage_team', parseSpy, run, done)
  await expect(acao(vazio, formulario('x'))).rejects.toThrow('NEXT_REDIRECT')
  expect(parseSpy).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})

test('o guarda roda em toda execução, não só na primeira', async () => {
  guards.requireTenant.mockResolvedValue(membro('OWNER'))
  const acao = tenantAction('manage_team', parse, async () => 'ok', done)
  await acao(vazio, formulario('a'))
  await acao(vazio, formulario('b'))
  expect(guards.requireTenant).toHaveBeenCalledTimes(2)
})

test('papel sem a capacidade recebe "sem permissão" e run não é chamado', async () => {
  guards.requireTenant.mockResolvedValue(membro('PROFESSIONAL'))
  const run = vi.fn()
  const parseSpy = vi.fn(parse)
  const estado = await tenantAction('manage_team', parseSpy, run, done)(vazio, formulario('x'))
  expect(estado.ok).toBe(false)
  expect(estado.message).toBe('Você não tem permissão para fazer isso.')
  expect(run).not.toHaveBeenCalled()
  expect(parseSpy).not.toHaveBeenCalled()
})

test('o gerente não passa por uma ação do dono da conta', async () => {
  guards.requireTenant.mockResolvedValue(membro('MANAGER'))
  const run = vi.fn()
  const estado = await tenantAction('manage_account', parse, run, done)(vazio, formulario('x'))
  expect(estado.message).toBe('Você não tem permissão para fazer isso.')
  expect(run).not.toHaveBeenCalled()
})

test('com a capacidade, run recebe o contexto e os valores lidos e done monta o estado', async () => {
  const ctx = membro('MANAGER')
  guards.requireTenant.mockResolvedValue(ctx)
  const run = vi.fn(async () => 'Equipe atualizada.')
  const estado = await tenantAction('manage_team', parse, run, done)(vazio, formulario('Bia'))
  expect(run).toHaveBeenCalledWith(ctx, { nome: 'Bia' })
  expect(estado).toEqual({ ok: true, message: 'Equipe atualizada.', fields: {}, values: { nome: 'Bia' } })
})

test('capacidade nula vale para qualquer membro', async () => {
  guards.requireTenant.mockResolvedValue(membro('PROFESSIONAL'))
  const estado = await tenantAction(null, parse, async () => 'feito', done)(vazio, formulario('x'))
  expect(estado.ok).toBe(true)
})

test('o suporte (impersonator) tem os poderes do dono', async () => {
  guards.requireTenant.mockResolvedValue(contexto({ kind: 'impersonator', adminId: 'a1', name: 'Suporte' }))
  const estado = await tenantAction('manage_settings', parse, async () => 'feito', done)(vazio, formulario('x'))
  expect(estado.ok).toBe(true)
})

test('erro de domínio vira mensagem e campos, mantendo o digitado', async () => {
  guards.requireTenant.mockResolvedValue(membro('OWNER'))
  const run = async () => {
    throw new DomainError('validation', 'Corrija os campos.', { fields: { nome: 'Informe o nome.' } })
  }
  const estado = await tenantAction('manage_team', parse, run, done)(vazio, formulario(''))
  expect(estado).toEqual({ ok: false, message: 'Corrija os campos.', fields: { nome: 'Informe o nome.' }, values: { nome: '' } })
})

test('erro de leitura do formulário volta como estado, com os valores anteriores', async () => {
  guards.requireTenant.mockResolvedValue(membro('OWNER'))
  const quebra = (): V => {
    throw new DomainError('validation', 'Formulário inválido.')
  }
  const estado = await tenantAction('manage_team', quebra, async () => 'x', done)({ ...vazio, values: { nome: 'antes' } }, formulario('x'))
  expect(estado.ok).toBe(false)
  expect(estado.values).toEqual({ nome: 'antes' })
})

test('erro inesperado vira a mensagem genérica, sem o texto original e sem a senha', async () => {
  guards.requireTenant.mockResolvedValue(membro('OWNER'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const run = async () => {
    throw new Error('connection refused postgres://u:senha@host')
  }
  const comSenha = (fd: FormData): V => ({ nome: String(fd.get('nome')), senha: 'segredo-123' })
  const estado = await tenantAction('manage_team', comSenha, run, done)(vazio, formulario('x'))
  expect(estado.ok).toBe(false)
  expect(estado.message).toMatch(/fale com o suporte/)
  expect(JSON.stringify(estado)).not.toContain('postgres://')
  expect(JSON.stringify(estado)).not.toContain('segredo-123')
  expect(JSON.stringify(log.mock.calls)).not.toContain('postgres://')
})

describe('redirect e notFound passam adiante, de run e de done', () => {
  const generico = (fd: FormData): V => ({ nome: String(fd.get('nome') ?? '') })

  test('redirect lançado por run', async () => {
    guards.requireTenant.mockResolvedValue(membro('OWNER'))
    const run = async (): Promise<string> => redirect('/painel/equipe')
    await expect(tenantAction('manage_team', generico, run, done)(vazio, formulario('x'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })
  })

  test('redirect lançado por done', async () => {
    guards.requireTenant.mockResolvedValue(membro('OWNER'))
    const fim = (): FormState<V> => redirect('/painel/equipe')
    await expect(tenantAction('manage_team', generico, async () => 'ok', fim)(vazio, formulario('x'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })
  })

  test('notFound lançado por run e por done', async () => {
    guards.requireTenant.mockResolvedValue(membro('OWNER'))
    const run = async (): Promise<string> => notFound()
    await expect(tenantAction('manage_team', generico, run, done)(vazio, formulario('x'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK'),
    })
    const fim = (): FormState<V> => notFound()
    await expect(tenantAction('manage_team', generico, async () => 'ok', fim)(vazio, formulario('x'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK'),
    })
  })
})

test('erro inesperado dentro de done vira a mensagem genérica, sem o texto original', async () => {
  guards.requireTenant.mockResolvedValue(membro('OWNER'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const fim = (): FormState<V> => {
    throw new Error('falha com postgres://u:senha@host')
  }
  const estado = await tenantAction('manage_team', parse, async () => 'ok', fim)(vazio, formulario('x'))
  expect(estado.ok).toBe(false)
  expect(estado.message).toMatch(/fale com o suporte/)
  expect(JSON.stringify(estado)).not.toContain('postgres://')
})

test('capacidade nula com o suporte (impersonator) executa', async () => {
  guards.requireTenant.mockResolvedValue(contexto({ kind: 'impersonator', adminId: 'a1', name: 'Suporte' }))
  const estado = await tenantAction(null, parse, async () => 'feito', done)(vazio, formulario('x'))
  expect(estado.ok).toBe(true)
})
