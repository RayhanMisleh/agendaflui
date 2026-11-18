import { startScheduler } from '@/server/notifications/scheduler'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Sem banco: estes testes olham só os temporizadores (o registro das execuções tem os seus mais abaixo). */
const noRecord = async (): Promise<void> => undefined
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

describe('startScheduler', () => {
  test('roda uma rodada por minuto e a limpeza uma vez por hora', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    const s = startScheduler({ record: noRecord, run, cleanup })
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
    const s = startScheduler({ record: noRecord, run, cleanup: async () => undefined })
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
    const s = startScheduler({ record: noRecord, run, cleanup: async () => { throw new RangeError('segredo@x.y') } })
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
    const s = startScheduler({ record: noRecord, run: async () => undefined, cleanup: async () => undefined })
    expect(unref).toHaveBeenCalled()
    spy.mockRestore()
    t.mockRestore()
    s.stop()
  })

  test('register chamado duas vezes no mesmo processo não cria dois intervalos', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const a = startScheduler({ record: noRecord, run, cleanup: async () => undefined })
    const b = startScheduler({ record: noRecord, run, cleanup: async () => undefined })
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    const chamadas = run.mock.calls.length
    expect(chamadas).toBeLessThanOrEqual(4)
    a.stop()
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(run.mock.calls.length).toBe(chamadas)
    b.stop()
    // depois de parar, um novo início volta a valer
    const c = startScheduler({ record: noRecord, run, cleanup: async () => undefined })
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
    const s = startScheduler({ record: noRecord, run: async () => undefined, cleanup: async () => undefined, flush })
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

  test('com worker: false só as métricas rodam (nem avisos nem limpeza)', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    const flush = vi.fn(async () => 0)
    const s = startScheduler({ record: noRecord, worker: false, run, cleanup, flush })
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(run).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(6)
    s.stop()
  })

  test('erro ao gravar a métrica não para o agendador', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flush = vi.fn(async () => {
      throw new Error('banco caiu')
    })
    const s = startScheduler({ record: noRecord, run: async () => undefined, cleanup: async () => undefined, flush })
    await vi.advanceTimersByTimeAsync(95_000)
    expect(flush).toHaveBeenCalledTimes(3)
    s.stop()
  })

  test('shutdown faz um último flush e não espera além do teto de tempo', async () => {
    vi.useFakeTimers()
    const flush = vi.fn(() => new Promise<number>(() => undefined))
    const s = startScheduler({ record: noRecord, run: async () => undefined, cleanup: async () => undefined, flush })
    const fim = s.shutdown()
    await vi.advanceTimersByTimeAsync(5_000)
    await fim
    expect(flush).toHaveBeenCalledTimes(1)
    s.stop()
  })
})

describe('startScheduler: registro das execuções', () => {
  type Gravada = { kind: string; ok: boolean; summary: string; startedAt: Date; finishedAt: Date }

  test('cada rodada de avisos e cada limpeza gravam uma execução, com contagens e sem dado pessoal', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const gravadas: Gravada[] = []
    const record = async (r: Gravada) => void gravadas.push(r)
    const run = vi.fn()
    run.mockResolvedValueOnce({ sent: 2, skipped: 0, failed: 1, retried: 0, email: 'maria@exemplo.test' })
    run.mockRejectedValueOnce(new TypeError('maria@exemplo.test'))
    const cleanup = vi.fn(async () => ({ limites: 3, passagens: 1 }))
    const s = startScheduler({ run, cleanup, flush: async () => 0, record })
    await vi.advanceTimersByTimeAsync(2_500)
    await vi.advanceTimersByTimeAsync(60_000)
    s.stop()
    expect(gravadas.map((g) => [g.kind, g.ok, g.summary])).toEqual([
      ['notifications', true, 'enviados 2, ignorados 0, falhas 1, novas tentativas 0'],
      ['cleanup', true, 'limites 3, passagens 1'],
      ['notifications', false, 'erro: TypeError'],
    ])
    expect(gravadas[0]?.finishedAt.getTime()).toBeGreaterThanOrEqual(gravadas[0]?.startedAt.getTime() ?? Number.POSITIVE_INFINITY)
    expect(JSON.stringify(gravadas)).not.toMatch(/maria|@/)
  })

  test('a varredura da loja roda a cada rodada e grava execução do tipo store só quando fez algo ou falhou', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const gravadas: Gravada[] = []
    const sweep = vi.fn()
    sweep.mockResolvedValueOnce({ synced: 0, expired: 0 }).mockResolvedValueOnce({ synced: 2, expired: 1 }).mockRejectedValueOnce(new TypeError('maria@exemplo.test')).mockResolvedValue({ synced: 0, expired: 0 })
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined, sweep, flush: async () => 0, record: async (r) => void gravadas.push(r) })
    await vi.advanceTimersByTimeAsync(2_500 + 60_000 * 3)
    s.stop()
    expect(sweep).toHaveBeenCalledTimes(4)
    expect(gravadas.filter((g) => g.kind === 'store').map((g) => [g.ok, g.summary])).toEqual([
      [true, 'pagamentos conferidos 2, pedidos vencidos 1'],
      [false, 'erro: TypeError'],
    ])
    expect(JSON.stringify(gravadas)).not.toContain('maria')
  })

  test('limpeza que lança grava ok: false', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const gravadas: Gravada[] = []
    const s = startScheduler({
      run: async () => undefined,
      cleanup: async () => {
        throw new RangeError('segredo@x.y')
      },
      flush: async () => 0,
      record: async (r) => void gravadas.push(r),
    })
    await vi.advanceTimersByTimeAsync(2_500)
    s.stop()
    expect(gravadas.find((g) => g.kind === 'cleanup')).toMatchObject({ ok: false, summary: 'erro: RangeError' })
  })

  test('as métricas de uso só gravam execução quando gravaram linhas ou falharam', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const gravadas: Gravada[] = []
    const flush = vi.fn()
    flush.mockResolvedValueOnce(0).mockResolvedValueOnce(4).mockRejectedValueOnce(new Error('banco caiu')).mockResolvedValue(0)
    const s = startScheduler({ worker: false, run: async () => undefined, cleanup: async () => undefined, flush, record: async (r) => void gravadas.push(r) })
    await vi.advanceTimersByTimeAsync(30_000 * 5)
    s.stop()
    expect(flush).toHaveBeenCalledTimes(5)
    expect(gravadas.map((g) => [g.kind, g.ok, g.summary])).toEqual([
      ['usage_flush', true, 'linhas 4'],
      ['usage_flush', false, 'erro: Error'],
    ])
  })

  test('falha ao gravar a execução é registrada só pelo nome e não derruba a rodada', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn(async () => ({ sent: 1 }))
    const s = startScheduler({ run, cleanup: async () => undefined, flush: async () => 0, record: async () => { throw new TypeError('maria@exemplo.test') } })
    await vi.advanceTimersByTimeAsync(130_000)
    s.stop()
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(log.mock.calls)).toContain('TypeError')
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/maria|@/)
  })
})

describe('startScheduler: registro que não responde', () => {
  test('um record que nunca resolve não impede a rodada seguinte nem a limpeza', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn(async () => ({ sent: 1 }))
    const cleanup = vi.fn(async () => undefined)
    const s = startScheduler({ run, cleanup, flush: async () => 0, record: () => new Promise<void>(() => undefined) })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(cleanup).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(3)
    s.stop()
  })
})

describe('startScheduler: retenção diária', () => {
  type Gravada = { kind: string; ok: boolean; summary: string }
  test('roda na primeira rodada e depois uma vez a cada 24 horas, gravando a execução como retention', async () => {
    vi.useFakeTimers()
    const gravadas: Gravada[] = []
    const retention = vi.fn(async () => ({ avisos: 5, uso: 0, auditoria: 1 }))
    const s = startScheduler({ run: async () => undefined, cleanup: async () => undefined, retention, flush: async () => 0, record: async (r) => void gravadas.push(r) })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(retention).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60 * 60_000 * 23)
    expect(retention).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60 * 60_000 * 2)
    expect(retention).toHaveBeenCalledTimes(2)
    s.stop()
    expect(gravadas.filter((g) => g.kind === 'retention').map((g) => [g.ok, g.summary])).toEqual([
      [true, 'avisos 5, uso 0, auditoria 1'],
      [true, 'avisos 5, uso 0, auditoria 1'],
    ])
  })

  test('falha da retenção é gravada só pelo nome e não impede a limpeza horária', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const gravadas: Gravada[] = []
    const cleanup = vi.fn(async () => undefined)
    const s = startScheduler({
      run: async () => undefined,
      cleanup,
      retention: async () => {
        throw new RangeError('segredo@x.y')
      },
      flush: async () => 0,
      record: async (r) => void gravadas.push(r),
    })
    await vi.advanceTimersByTimeAsync(2_500)
    s.stop()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(gravadas.find((g) => g.kind === 'retention')).toMatchObject({ ok: false, summary: 'erro: RangeError' })
  })
})
