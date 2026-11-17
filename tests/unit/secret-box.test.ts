import { afterEach, describe, expect, test, vi } from 'vitest'
import { lastFour, openSecret, sealSecret, SecretBoxError } from '@/server/auth/secret-box'

const AAD = '11111111-1111-4111-8111-111111111111:mercadopago:access_token'
const SEGREDO = 'TEST-valor-inventado-so-do-teste-Qz7K'

/** Troca um caractere da parte `i` do selo (0 = versão, 1 = iv, 2 = cifra, 3 = tag) por outro caractere base64url. */
function adulterar(selo: string, i: number): string {
  const partes = selo.split('.')
  const p = partes[i] ?? ''
  partes[i] = (p.startsWith('A') ? 'B' : 'A') + p.slice(1)
  return partes.join('.')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('secret-box', () => {
  test('ida e volta devolve o texto original', () => {
    expect(openSecret(sealSecret(SEGREDO, AAD), AAD)).toBe(SEGREDO)
  })

  test('o selo tem o formato v1.<iv>.<cifra>.<tag> em base64url e não contém o texto puro', () => {
    const selo = sealSecret(SEGREDO, AAD)
    const partes = selo.split('.')
    expect(partes).toHaveLength(4)
    expect(partes[0]).toBe('v1')
    for (const p of partes.slice(1)) expect(p).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(partes[1] ?? '', 'base64url')).toHaveLength(12)
    expect(Buffer.from(partes[3] ?? '', 'base64url')).toHaveLength(16)
    expect(selo).not.toContain(SEGREDO)
    expect(selo).not.toContain('Qz7K')
  })

  test('dois selos do mesmo texto são diferentes (iv aleatório) e os dois abrem', () => {
    const a = sealSecret(SEGREDO, AAD)
    const b = sealSecret(SEGREDO, AAD)
    expect(a).not.toBe(b)
    expect(openSecret(a, AAD)).toBe(SEGREDO)
    expect(openSecret(b, AAD)).toBe(SEGREDO)
  })

  test.each([
    ['o iv', 1],
    ['a cifra', 2],
    ['a tag', 3],
    ['a versão', 0],
  ])('um byte trocado em %s faz abrir falhar com SecretBoxError', (_nome, parte) => {
    const selo = sealSecret(SEGREDO, AAD)
    expect(() => openSecret(adulterar(selo, parte), AAD)).toThrow(SecretBoxError)
  })

  test('aad de outra conta, de outro provedor ou de outro campo falha', () => {
    const selo = sealSecret(SEGREDO, AAD)
    expect(() => openSecret(selo, '22222222-2222-4222-8222-222222222222:mercadopago:access_token')).toThrow(SecretBoxError)
    expect(() => openSecret(selo, '11111111-1111-4111-8111-111111111111:frenet:access_token')).toThrow(SecretBoxError)
    expect(() => openSecret(selo, '11111111-1111-4111-8111-111111111111:mercadopago:webhook_secret')).toThrow(SecretBoxError)
  })

  test('entrada que não é selo falha com SecretBoxError e a mensagem não repete a entrada', () => {
    for (const lixo of ['', 'v1', 'v1.a.b', 'v2.a.b.c', 'v1.a.b.c.d', 'texto qualquer', SEGREDO]) {
      let erro: unknown
      try {
        openSecret(lixo, AAD)
      } catch (e) {
        erro = e
      }
      expect(erro).toBeInstanceOf(SecretBoxError)
      expect((erro as Error).message).not.toContain(SEGREDO)
    }
  })

  test('outra APP_SECRET não abre o selo', async () => {
    const selo = sealSecret(SEGREDO, AAD)
    vi.resetModules()
    vi.stubEnv('APP_SECRET', 'outro-segredo-de-teste-com-no-minimo-32-caracteres')
    const outra = await import('@/server/auth/secret-box')
    expect(() => outra.openSecret(selo, AAD)).toThrow(outra.SecretBoxError)
  })

  test('lastFour devolve os 4 últimos caracteres', () => {
    expect(lastFour(SEGREDO)).toBe('Qz7K')
    expect(lastFour('abcd')).toBe('abcd')
  })
})
