import { register, shouldStartWorker } from '@/instrumentation'

const start = vi.hoisted(() => vi.fn(() => ({ stop: () => undefined })))
vi.mock('@/server/notifications/scheduler', () => ({ startScheduler: start }))

const base = {
  NEXT_RUNTIME: 'nodejs',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
  APP_SECRET: 'a'.repeat(40),
}

function ambiente(extra: Record<string, string | undefined>) {
  vi.unstubAllEnvs()
  for (const [k, v] of Object.entries({ ...base, ...extra })) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
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

describe('register', () => {
  test('com WORKER_ENABLED=false não inicia o agendador', async () => {
    ambiente({ WORKER_ENABLED: 'false' })
    await register()
    expect(start).not.toHaveBeenCalled()
  })

  test('no runtime Node com o agendador ligado, inicia uma vez', async () => {
    ambiente({ WORKER_ENABLED: 'true' })
    await register()
    expect(start).toHaveBeenCalledTimes(1)
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
})
