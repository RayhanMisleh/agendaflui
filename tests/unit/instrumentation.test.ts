import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register, shouldRunInProcess, shouldStartWorker } from '@/instrumentation'

const start = vi.hoisted(() => vi.fn(() => ({ stop: () => undefined })))
vi.mock('@/server/notifications/scheduler', () => ({ startScheduler: start }))

const base = {
  NEXT_RUNTIME: 'nodejs',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
  APP_SECRET: 'a'.repeat(40),
  DEV_HOST: 'dev.exemplo.com',
  APP_HOST: 'app.exemplo.com',
  TRUSTED_PROXY_HOPS: '1',
  SMTP_URL: 'smtp://u:senha-secreta@h:587',
  MAIL_FROM: 'A <a@exemplo.com>',
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'chave-de-teste',
  STORAGE_DIR: tmpdir(),
}

function ambiente(extra: Record<string, string | undefined>) {
  vi.unstubAllEnvs()
  for (const [k, v] of Object.entries({ ...base, ...extra })) {
    vi.stubEnv(k, v)
  }
}

beforeEach(() => start.mockClear())
afterEach(() => vi.unstubAllEnvs())

describe('shouldStartWorker', () => {
  test.each([
    [{ ...base }, true],
    [{ ...base, WORKER_ENABLED: 'true' }, true],
    [{ ...base, NODE_ENV: 'development' }, true],
    [{ ...base, WORKER_ENABLED: 'false' }, false],
    [{ ...base, NEXT_RUNTIME: 'edge' }, false],
    [{ ...base, NEXT_RUNTIME: undefined }, false],
    [{ ...base, NODE_ENV: 'test' }, false],
    [{ ...base, NEXT_PHASE: 'phase-production-build' }, false],
  ])('%j -> %s', (source, esperado) => {
    expect(shouldStartWorker(source)).toBe(esperado)
  })
})

describe('shouldRunInProcess', () => {
  test.each([
    [{ ...base }, true],
    [{ ...base, WORKER_ENABLED: 'false' }, true],
    [{ ...base, NEXT_RUNTIME: 'edge' }, false],
    [{ ...base, NODE_ENV: 'test' }, false],
    [{ ...base, NEXT_PHASE: 'phase-production-build' }, false],
  ])('%j -> %s', (source, esperado) => {
    expect(shouldRunInProcess(source)).toBe(esperado)
  })
})

describe('register', () => {
  test('com WORKER_ENABLED=false o agendador sobe só para as métricas (sem avisos nem limpeza)', async () => {
    ambiente({ WORKER_ENABLED: 'false' })
    await register()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ worker: false })
  })

  test('no runtime Node com o agendador ligado, inicia uma vez', async () => {
    ambiente({ WORKER_ENABLED: 'true' })
    await register()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ worker: true })
  })

  test('no runtime edge não inicia nem valida nada', async () => {
    ambiente({ NEXT_RUNTIME: 'edge', APP_SECRET: 'curto' })
    await register()
    expect(start).not.toHaveBeenCalled()
  })

  test('durante o build não inicia', async () => {
    ambiente({ NEXT_PHASE: 'phase-production-build' })
    await register()
    expect(start).not.toHaveBeenCalled()
  })

  test('em produção com segredo de exemplo falha cedo, sem imprimir o valor', async () => {
    ambiente({ APP_SECRET: 'EXEMPLO-troque-este-valor-por-um-segredo-aleatorio-de-32-ou-mais' })
    const erro = await register().then(() => null, (e: unknown) => e)
    expect(erro).toBeInstanceOf(Error)
    expect(String(erro)).toMatch(/APP_SECRET/)
    expect(String(erro)).not.toContain('EXEMPLO-troque')
    expect(start).not.toHaveBeenCalled()
  })

  test('em produção recusa host local, sem imprimir o valor', async () => {
    ambiente({ APP_HOST: 'app.localhost:3000' })
    const erro = await register().then(() => null, (e: unknown) => e)
    expect(String(erro)).toMatch(/APP_HOST/)
    expect(String(erro)).not.toContain('app.localhost')
    expect(start).not.toHaveBeenCalled()
  })

  test('em produção recusa STORAGE_DIR que não existe', async () => {
    ambiente({ STORAGE_DIR: join(tmpdir(), 'agendaflui-nao-existe-xyz') })
    const erro = await register().then(() => null, (e: unknown) => e)
    expect(String(erro)).toMatch(/STORAGE_DIR/)
    expect(start).not.toHaveBeenCalled()
  })

  test('em produção sem proxy confiável nem SMTP_URL avisa alto e sobe mesmo assim, sem vazar valores', async () => {
    ambiente({ TRUSTED_PROXY_HOPS: '0', SMTP_URL: undefined, MAIL_FROM: undefined })
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await register()
      const texto = aviso.mock.calls.flat().join('\n')
      expect(texto).toMatch(/limites por IP desligados e auditoria sem IP/)
      expect(texto).toMatch(/convites e cadastro de clientes não chegam/)
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      aviso.mockRestore()
    }
  })

  test('configuração completa em produção não avisa nada', async () => {
    ambiente({})
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await register()
      expect(aviso).not.toHaveBeenCalled()
    } finally {
      aviso.mockRestore()
    }
  })

  test('fora de produção não confere a pasta de armazenamento', async () => {
    ambiente({ NODE_ENV: 'development', STORAGE_DIR: join(tmpdir(), 'agendaflui-nao-existe-xyz') })
    await register()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
