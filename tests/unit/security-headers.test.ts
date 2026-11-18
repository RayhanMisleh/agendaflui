import { afterEach, describe, expect, test, vi } from 'vitest'
import nextConfig from '../../next.config'

afterEach(() => vi.unstubAllEnvs())

async function cabecalhos(origem: string): Promise<Record<string, string>> {
  const regras = (await nextConfig.headers?.()) ?? []
  const saida: Record<string, string> = {}
  for (const regra of regras) {
    if (regra.source !== origem) continue
    for (const h of regra.headers) saida[h.key] = h.value
  }
  return saida
}

describe('cabeçalhos de segurança (next.config)', () => {
  test('todas as rotas levam os cabeçalhos básicos', async () => {
    const h = await cabecalhos('/:path*')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  })

  test('em produção acrescenta HSTS de um ano com subdomínios', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect((await cabecalhos('/:path*'))['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains')
  })

  test('fora de produção não manda HSTS (o navegador o guardaria para localhost)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await cabecalhos('/:path*'))['Strict-Transport-Security']).toBeUndefined()
    vi.stubEnv('NODE_ENV', 'test')
    expect((await cabecalhos('/:path*'))['Strict-Transport-Security']).toBeUndefined()
  })

  test('nenhum cabeçalho aparece duas vezes na mesma rota', async () => {
    const regras = (await nextConfig.headers?.()) ?? []
    for (const regra of regras) {
      const chaves = regra.headers.map((h) => h.key)
      expect(new Set(chaves).size).toBe(chaves.length)
    }
  })
})
