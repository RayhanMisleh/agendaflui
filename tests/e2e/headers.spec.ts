import { expect, test } from '@playwright/test'

const DEV = `http://${process.env.DEV_HOST || 'dev.localhost:3000'}`
const PAINEL = `http://${process.env.PAINEL_HOST || 'painel.localhost:3000'}`
const API = `http://${process.env.API_HOST || 'api.localhost:3000'}`

const paginas = [
  ['entrar do painel da plataforma', `${DEV}/entrar`],
  ['entrar do painel do negócio', `${PAINEL}/entrar`],
  ['saúde da API', `${API}/v1/health`],
] as const

for (const [nome, url] of paginas) {
  test(`cabeçalhos de segurança em ${nome}`, async ({ page }) => {
    const resposta = await page.goto(url)
    expect(resposta?.status()).toBe(200)
    const h = resposta!.headers()
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['content-security-policy']).toBe("frame-ancestors 'none'")
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(h['x-powered-by']).toBeUndefined()
  })
}
