import { describe, expect, test, vi } from 'vitest'
import { shouldMigrate, waitForDatabase } from '../../scripts/start-helpers'

describe('waitForDatabase', () => {
  test('conecta de primeira sem esperar', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    await waitForDatabase(() => Promise.resolve(), { attempts: 5, delayMs: 10, sleep })
    expect(sleep).not.toHaveBeenCalled()
  })

  test('tenta de novo até o banco aceitar', async () => {
    const connect = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue(undefined)
    const sleep = vi.fn(() => Promise.resolve())
    await waitForDatabase(connect, { attempts: 5, delayMs: 10, sleep })
    expect(connect).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  test('esgotadas as tentativas, falha sem repetir a mensagem do driver (que pode ter a URL)', async () => {
    const connect = vi.fn(() => Promise.reject(new Error('postgres://u:senha-secreta@h/d recusou')))
    const erro = await waitForDatabase(connect, { attempts: 3, delayMs: 1, sleep: () => Promise.resolve() }).then(() => null, (e: unknown) => e)
    expect(connect).toHaveBeenCalledTimes(3)
    expect(String(erro)).toMatch(/banco/)
    expect(String(erro)).toMatch(/DATABASE_URL/)
    expect(String(erro)).not.toContain('senha-secreta')
  })

  test('a mensagem final traz a categoria do último erro', async () => {
    const connect = () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))
    const erro = await waitForDatabase(connect, { attempts: 2, delayMs: 1, sleep: () => Promise.resolve() }).then(() => null, (e: unknown) => e)
    expect(String(erro)).toMatch(/host não encontrado/)
  })
})

describe('shouldMigrate', () => {
  test('liga por padrão e desliga só com MIGRATE_ON_START=false', () => {
    expect(shouldMigrate({})).toBe(true)
    expect(shouldMigrate({ MIGRATE_ON_START: 'true' })).toBe(true)
    expect(shouldMigrate({ MIGRATE_ON_START: '' })).toBe(true)
    expect(shouldMigrate({ MIGRATE_ON_START: 'false' })).toBe(false)
  })
})
