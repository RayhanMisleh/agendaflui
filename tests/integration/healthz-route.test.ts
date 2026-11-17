import { describe, expect, test } from 'vitest'
import { createHealthHandler } from '@/server/db/health'

const { GET } = await import('@/app/healthz/route')

describe('/healthz', () => {
  test('banco respondendo: 200 {"status":"ok"} sem cache', async () => {
    const r = await GET()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'ok' })
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  test('banco com erro: 503 {"status":"degraded"} sem detalhe do erro', async () => {
    const r = await createHealthHandler(() => Promise.reject(new Error('senha=segredo host=interno')))()
    expect(r.status).toBe(503)
    const texto = await r.text()
    expect(JSON.parse(texto)).toEqual({ status: 'degraded' })
    expect(texto).not.toContain('segredo')
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  test('banco que não responde dentro do limite: 503 rápido', async () => {
    const inicio = Date.now()
    const r = await createHealthHandler(() => new Promise<void>(() => undefined), 50)()
    expect(r.status).toBe(503)
    expect(Date.now() - inicio).toBeLessThan(1000)
  })

  test('banco lento mas dentro do limite: 200', async () => {
    const r = await createHealthHandler(() => new Promise<void>((ok) => setTimeout(ok, 20)), 500)()
    expect(r.status).toBe(200)
  })
})
