import { DomainError } from '@/server/domain/errors'
import { formError } from '@/app/dev/(app)/_lib/form-state'
import type { FormState } from '@/app/dev/(app)/_lib/form-state'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)

type Valores = { name: string; slug: string; password?: string; owner?: { email: string; token?: string } }

afterEach(() => {
  vi.restoreAllMocks()
  guards.requirePlatformAdmin.mockReset()
})

test('erro de validação devolve os campos e mantém o que foi digitado', () => {
  const erro = new DomainError('validation', 'Corrija os campos.', { fields: { slug: 'Use de 3 a 40 letras.' } })
  const estado = formError<Valores>(erro, { name: 'Pata Viva', slug: 'x' })
  expect(estado).toEqual({
    ok: false,
    message: 'Corrija os campos.',
    fields: { slug: 'Use de 3 a 40 letras.' },
    values: { name: 'Pata Viva', slug: 'x' },
  })
})

test('senha e segredo nunca voltam em values, nem dentro de objetos', () => {
  const erro = new DomainError('validation', 'Erro', { fields: { name: 'Informe o nome.' } })
  const estado = formError<Valores>(erro, {
    name: '',
    slug: 'abc',
    password: 'senha-secreta-1',
    owner: { email: 'a@b.com', token: 'tok-123' },
  })
  expect(JSON.stringify(estado)).not.toContain('senha-secreta-1')
  expect(JSON.stringify(estado)).not.toContain('tok-123')
  expect(estado.values.name).toBe('')
  expect(estado.values.owner?.email).toBe('a@b.com')
})

test('erro inesperado vira mensagem genérica, sem o texto original, e só o nome vai para o log', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const estado = formError<Valores>(new TypeError('connection to 10.0.0.5 refused, password=hunter2'), { name: 'A', slug: 'abc' })
  expect(estado.ok).toBe(false)
  expect(estado.fields).toEqual({})
  expect(estado.message).toBe('Não foi possível concluir agora. Tente de novo em instantes; se continuar, avise quem cuida da plataforma.')
  expect(estado.message).not.toContain('10.0.0.5')
  expect(estado.values).toEqual({ name: 'A', slug: 'abc' })
  const linha = String(log.mock.calls[0]?.[0])
  expect(linha).toContain('TypeError')
  expect(linha).not.toContain('hunter2')
})

test('erro de redirecionamento do Next passa adiante em vez de virar mensagem', () => {
  const redirecionamento = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/entrar;307;' })
  expect(() => formError<Valores>(redirecionamento, { name: 'A', slug: 'abc' })).toThrow(redirecionamento)
})

test('adminAction sem sessão de admin não executa nada', async () => {
  guards.requirePlatformAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))
  const { adminAction } = await import('@/app/dev/(app)/_lib/action')
  const parse = vi.fn((fd: FormData) => ({ name: String(fd.get('name') ?? '') }))
  const run = vi.fn(async () => 'feito')
  const acao = adminAction(parse, run, () => ({ ok: true, message: 'Feito.', fields: {}, values: { name: '' } }))
  const inicial: FormState<{ name: string }> = { ok: false, message: null, fields: {}, values: { name: '' } }
  await expect(acao(inicial, new FormData())).rejects.toThrow('NEXT_REDIRECT')
  expect(run).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
})

test('adminAction com admin: lê o formulário, executa e devolve o estado do sucesso', async () => {
  const admin = { kind: 'platform_admin' as const, adminId: 'a1', name: 'Gabriel' }
  guards.requirePlatformAdmin.mockResolvedValue(admin)
  const { adminAction } = await import('@/app/dev/(app)/_lib/action')
  const run = vi.fn(async (_a: typeof admin, v: { name: string }) => v.name.toUpperCase())
  const acao = adminAction(
    (fd) => ({ name: String(fd.get('name') ?? '') }),
    run,
    (r) => ({ ok: true, message: `Criada ${r}.`, fields: {}, values: { name: '' } }),
  )
  const fd = new FormData()
  fd.set('name', 'pata')
  const estado = await acao({ ok: false, message: null, fields: {}, values: { name: '' } }, fd)
  expect(run).toHaveBeenCalledWith(admin, { name: 'pata' })
  expect(estado.message).toBe('Criada PATA.')
})

test('adminAction converte DomainError em estado de formulário com os valores digitados', async () => {
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: 'a1', name: 'G' })
  const { adminAction } = await import('@/app/dev/(app)/_lib/action')
  const acao = adminAction(
    (fd) => ({ name: String(fd.get('name') ?? '') }),
    async () => {
      throw new DomainError('validation', 'Já existe.', { fields: { name: 'Já existe uma conta com este nome.' } })
    },
    () => ({ ok: true, message: null, fields: {}, values: { name: '' } }),
  )
  const fd = new FormData()
  fd.set('name', 'Pata')
  const estado = await acao({ ok: false, message: null, fields: {}, values: { name: '' } }, fd)
  expect(estado).toMatchObject({ ok: false, fields: { name: 'Já existe uma conta com este nome.' }, values: { name: 'Pata' } })
})
