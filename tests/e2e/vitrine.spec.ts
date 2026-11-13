import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const shell = '[data-testid="demo-shell"]'

/** Abre a vitrine e espera a hidratação: capturar antes dela faz o Playwright mexer nos campos e gera aviso do React. */
async function abrir(page: Page) {
  await page.goto('/vitrine')
  await page.waitForFunction(() => {
    const b = document.querySelector('button')
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'))
  })
}

test('trocar a marca muda a capa ao vivo', async ({ page }) => {
  await abrir(page)
  const cover = () => page.locator(shell).evaluate((el) => getComputedStyle(el).getPropertyValue('--cover').trim())
  const before = await cover()
  await page.getByRole('button', { name: 'Barbearia' }).click()
  expect(await cover()).not.toBe(before)
  await expect(page.locator(shell)).toHaveAttribute('data-material', 'leather')
})

test('cor de baixo contraste mostra aviso', async ({ page }) => {
  await abrir(page)
  await page.getByLabel('Cor principal').fill('#808080')
  await expect(page.getByText('A cor principal foi escurecida para o texto ficar legível.')).toBeVisible()
})

test('cor inválida mostra erro e mantém a prévia anterior', async ({ page }) => {
  await abrir(page)
  const cover = () => page.locator(shell).evaluate((el) => getComputedStyle(el).getPropertyValue('--cover').trim())
  const before = await cover()
  await page.getByLabel('Cor principal').fill('azul')
  await expect(page.getByText(/Use uma cor no formato #RRGGBB/)).toBeVisible()
  expect(await cover()).toBe(before)
})

test('sem rolagem horizontal', async ({ page }) => {
  await abrir(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('atalho Pet shop aplica linho e fonte amigável', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await expect(page.locator(shell)).toHaveAttribute('data-material', 'linen')
  await expect(page.locator(shell)).toHaveAttribute('data-font', 'friendly')
})

test('o diálogo da demonstração abre e fecha com Esc', async ({ page }) => {
  await abrir(page)
  await page.locator(shell).getByRole('button', { name: 'Novo agendamento' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('o item de menu ativo tem aria-current', async ({ page }) => {
  await abrir(page)
  const current = page.locator(shell).getByRole('navigation', { name: 'Principal' }).locator('[aria-current="page"]')
  await expect(current.first()).toBeAttached()
  await expect(current).toHaveCount(1)
})

test('no celular, a barra de divisórias fica na base e Mais abre a folha', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'só no celular')
  await abrir(page)
  const nav = page.locator(shell).getByRole('navigation', { name: 'Principal' })
  await nav.scrollIntoViewIfNeeded()
  await expect(nav).toBeVisible()
  const box = await nav.boundingBox()
  const vh = page.viewportSize()!.height
  expect(box!.y + box!.height).toBeGreaterThan(vh - 4)
  await page.locator(shell).getByRole('button', { name: 'Mais' }).click()
  await expect(page.getByRole('dialog', { name: 'Mais' })).toBeVisible()
})

test('a página carrega sem erro de console nem pageerror', async ({ page }) => {
  const problemas: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') problemas.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`))
  await abrir(page)
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await page.getByRole('button', { name: 'Barbearia' }).click()
  await page.waitForTimeout(300)
  expect(problemas).toEqual([])
})

test('a tabela de clientes não quebra telefone nem data no meio', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'no celular a lista vira cartões')
  await abrir(page)
  await page.getByRole('button', { name: 'Barbearia' }).click()
  const table = page.locator(shell).locator('table')
  await expect(table).toBeVisible()
  const linhas = await table.evaluate((t) => {
    const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent ?? '')
    const col = (nome: string) => heads.indexOf(nome)
    const alvo = [col('Telefone'), col('Última visita'), col('Pontos')]
    const medir = (el: Element) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return { texto: el.textContent, linhas: new Set(Array.from(r.getClientRects()).map((q) => Math.round(q.top))).size, ws: getComputedStyle(el).whiteSpace }
    }
    const out = Array.from(t.querySelectorAll('tbody tr')).flatMap((tr) => alvo.map((i) => medir(tr.children[i]!)))
    out.push(...alvo.map((i) => medir(t.querySelectorAll('thead th')[i]!)))
    return out
  })
  expect(linhas.length).toBeGreaterThan(10)
  for (const c of linhas) {
    expect(c.linhas, `"${c.texto}" ocupa mais de uma linha`).toBe(1)
    expect(c.ws).toBe('nowrap')
  }
})

test('a lista vira cartões quando a folha é estreita, mesmo em tela larga', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'só no computador')
  await abrir(page)
  await page.addStyleTag({ content: '.vt-preview { max-width: 34rem; }' })
  const demo = page.locator(shell)
  await expect(demo.locator('table')).toBeHidden()
  await expect(demo.locator('ul.af-datalist__cards').first()).toBeVisible()
})

test('a coluna com o menu acompanha a rolagem no computador', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'só no computador')
  await abrir(page)
  const box = (await page.locator(shell).boundingBox())!
  await page.evaluate((y) => window.scrollTo(0, y), box.y + box.height / 2 - 300)
  const agenda = page.locator(shell).getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Agenda' })
  await expect(agenda).toBeInViewport()
})

test('nome de marca longo não encosta na primeira divisória', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'só no computador')
  await abrir(page)
  await page.getByLabel('Nome do negócio').fill('Clínica Veterinária e Pet Shop Amigos de Quatro Patas')
  const nome = (await page.locator(shell).locator('.af-brand__name').boundingBox())!
  const primeira = (await page.locator(shell).locator('.af-divider').first().boundingBox())!
  expect(primeira.y).toBeGreaterThanOrEqual(nome.y + nome.height)
})

test('trocar de atalho zera a aba de profissional', async ({ page }) => {
  await abrir(page)
  const abas = page.locator(shell).getByRole('tablist', { name: 'Profissional' })
  await abas.getByRole('tab', { name: 'Rafael' }).click()
  await expect(abas.getByRole('tab', { name: 'Rafael' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Barbearia' }).click()
  await expect(abas.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
})

test('capturas para revisão', async ({ page }, info) => {
  await abrir(page)
  // Em captura de página inteira o navegador não rola: a barra "sticky" da base cairia em cima da capa e a coluna
  // "sticky" do computador ficaria só no topo. Para a captura, os dois ficam no fluxo (o comportamento colado é testado à parte).
  await page.addStyleTag({
    content: `.af-shell__nav { position: static !important; }
      @media (min-width: 768px) { .af-shell__rail { position: relative !important; height: auto !important; max-height: none !important; align-self: stretch !important; } }`,
  })
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-padrao.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-petshop.png`, fullPage: true })
  await page.getByRole('button', { name: 'Barbearia' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-barbearia.png`, fullPage: true })
})
