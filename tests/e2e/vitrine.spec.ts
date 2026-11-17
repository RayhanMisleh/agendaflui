import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const DEV = `http://${process.env.DEV_HOST || 'dev.localhost:3000'}`
const pagina = '.vt-page'

/** Entra como admin da plataforma (a vitrine é do painel dev), abre a vitrine e espera a hidratação. */
async function abrir(page: Page) {
  await page.goto(`${DEV}/entrar`)
  await page.waitForFunction(() => {
    const b = document.querySelector('form button')
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'))
  })
  await page.getByLabel('E-mail').fill(process.env.SEED_ADMIN_EMAIL!)
  await page.getByLabel('Senha').fill(process.env.SEED_ADMIN_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(`${DEV}/`)
  await page.goto(`${DEV}/vitrine`)
  await page.waitForFunction(() => {
    const b = document.querySelector('.vt-page button')
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'))
  })
}

const conta = (page: Page, nome: string) => page.getByRole('group', { name: 'Conta de exemplo' }).getByRole('button', { name: nome, exact: true })
const marca = (page: Page) => page.locator(pagina).evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim())

test('trocar a conta muda a cor da marca ao vivo', async ({ page }) => {
  await abrir(page)
  const antes = await marca(page)
  await conta(page, 'Patas & Cia').click()
  await expect(conta(page, 'Patas & Cia')).toHaveAttribute('aria-pressed', 'true')
  expect(await marca(page)).not.toBe(antes)
})

test('o tema noite troca o esquema da página e Dia volta', async ({ page }) => {
  await abrir(page)
  const tema = page.getByRole('group', { name: 'Tema' })
  await tema.getByRole('button', { name: 'Noite' }).click()
  await expect(page.locator(pagina)).toHaveAttribute('data-scheme', 'night')
  await tema.getByRole('button', { name: 'Dia' }).click()
  await expect(page.locator(pagina)).toHaveAttribute('data-scheme', 'day')
})

test('cor inválida mostra erro', async ({ page }) => {
  await abrir(page)
  await page.getByRole('textbox', { name: 'Cor da conta' }).fill('azul')
  await expect(page.getByText(/Use uma cor no formato #RRGGBB/)).toBeVisible()
})

test('sem rolagem horizontal', async ({ page }) => {
  await abrir(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('o diálogo da vitrine abre e fecha com Esc', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Abrir diálogo' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('a página carrega sem erro de console nem pageerror', async ({ page }) => {
  const problemas: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`))
  await abrir(page)
  await conta(page, 'Patas & Cia').click()
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Noite' }).click()
  await page.waitForTimeout(300)
  expect(problemas).toEqual([])
})

test('a lista não quebra telefone nem data no meio', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'no celular a lista vira cartões')
  await abrir(page)
  const table = page.getByRole('table', { name: 'Clientes de exemplo' })
  await expect(table).toBeVisible()
  const linhas = await table.evaluate((t) => {
    const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent ?? '')
    const alvo = [heads.indexOf('Telefone'), heads.indexOf('Última visita')]
    const medir = (el: Element) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return { texto: el.textContent, linhas: new Set(Array.from(r.getClientRects()).map((q) => Math.round(q.top))).size, ws: getComputedStyle(el).whiteSpace }
    }
    const out = Array.from(t.querySelectorAll('tbody tr')).flatMap((tr) => alvo.map((i) => medir(tr.children[i]!)))
    out.push(...alvo.map((i) => medir(t.querySelectorAll('thead th')[i]!)))
    return out
  })
  expect(linhas.length).toBeGreaterThan(4)
  for (const c of linhas) {
    expect(c.linhas, `"${c.texto}" ocupa mais de uma linha`).toBe(1)
    expect(c.ws).toBe('nowrap')
  }
})

test('a lista vira cartões quando o contêiner é estreito, mesmo em tela larga', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'só no computador')
  await abrir(page)
  const lista = page.locator('.af-datalist').first()
  await expect(lista.locator('thead')).toBeVisible()
  await page.addStyleTag({ content: '.af-datalist { max-width: 20rem; }' })
  await expect(lista.locator('thead')).toBeHidden()
})

test('capturas para revisão', async ({ page }, info) => {
  await abrir(page)
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-dia.png`, fullPage: true })
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Noite' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-noite.png`, fullPage: true })
})
