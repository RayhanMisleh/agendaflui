import { startScheduler } from '@/server/notifications/scheduler'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

describe('startScheduler', () => {
  test('roda uma rodada por minuto e a limpeza uma vez por hora', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    const s = startScheduler({ run, cleanup })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000 * 59)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(59)
    expect(cleanup).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000 * 2)
    expect(cleanup).toHaveBeenCalledTimes(2)
    s.stop()
    const antes = run.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(run.mock.calls.length).toBe(antes)
  })

  test('não sobrepõe rodadas: se a anterior ainda roda, pula', async () => {
    vi.useFakeTimers()
    let ativas = 0
    let maximo = 0
    const run = vi.fn(async () => {
      ativas += 1
      maximo = Math.max(maximo, ativas)
      await sleep(150_000)
      ativas -= 1
    })
    const s = startScheduler({ run, cleanup: async () => undefined })
    await vi.advanceTimersByTimeAsync(60_000 * 6)
    expect(maximo).toBe(1)
    expect(run.mock.calls.length).toBeLessThan(6)
    s.stop()
  })

  test('erro numa rodada é registrado só pelo nome, sem dados, e a seguinte roda', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn()
    run.mockRejectedValueOnce(new TypeError('maria@exemplo.test e ExponentPushToken[abc]'))
    run.mockResolvedValue(undefined)
    const s = startScheduler({ run, cleanup: async () => { throw new RangeError('segredo@x.y') } })
    await vi.advanceTimersByTimeAsync(130_000)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    const texto = JSON.stringify(log.mock.calls)
    expect(texto).toContain('TypeError')
    expect(texto).toContain('RangeError')
    expect(texto).not.toMatch(/maria@|ExponentPushToken|segredo@/)
    s.stop()
  })

  test('os temporizadores não seguram o processo (unref)', async () => {
    const unref = vi.fn()
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({ unref, ref: vi.fn() })) as unknown as typeof setInterval)
    const t = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => ({ unref, ref: vi.fn() })) as unknown as typeof setTimeout)
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined })
    expect(unref).toHaveBeenCalled()
    spy.mockRestore()
    t.mockRestore()
    s.stop()
  })

  test('register chamado duas vezes no mesmo processo não cria dois intervalos', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const a = startScheduler({ run, cleanup: async () => undefined })
    const b = startScheduler({ run, cleanup: async () => undefined })
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    const chamadas = run.mock.calls.length
    expect(chamadas).toBeLessThanOrEqual(4)
    a.stop()
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(run.mock.calls.length).toBe(chamadas)
    b.stop()
    // depois de parar, um novo início volta a valer
    const c = startScheduler({ run, cleanup: async () => undefined })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run.mock.calls.length).toBe(chamadas + 1)
    c.stop()
  })
})

describe('startScheduler: métricas de uso', () => {
  test('grava a métrica a cada 30 segundos, uma execução por vez', async () => {
    vi.useFakeTimers()
    let ativas = 0
    let maximo = 0
    const flush = vi.fn(async () => {
      ativas += 1
      maximo = Math.max(maximo, ativas)
      await sleep(45_000)
      ativas -= 1
      return 0
    })
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined, flush })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(maximo).toBe(1)
    s.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  test('erro ao gravar a métrica não para o agendador', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flush = vi.fn(async () => {
      throw new Error('banco caiu')
    })
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined, flush })
    await vi.advanceTimersByTimeAsync(95_000)
    expect(flush).toHaveBeenCalledTimes(3)
    s.stop()
  })

  test('shutdown faz um último flush e não espera além do teto de tempo', async () => {
    vi.useFakeTimers()
    const flush = vi.fn(() => new Promise<number>(() => undefined))
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined, flush })
    const fim = s.shutdown()
    await vi.advanceTimersByTimeAsync(5_000)
    await fim
    expect(flush).toHaveBeenCalledTimes(1)
    s.stop()
  })
})
