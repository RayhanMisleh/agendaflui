import { expect, test } from '@playwright/test'

const shell = '[data-testid="demo-shell"]'

test('trocar a marca muda a capa ao vivo', async ({ page }) => {
  await page.goto('/vitrine')
  const cover = () => page.locator(shell).evaluate((el) => getComputedStyle(el).getPropertyValue('--cover').trim())
  const before = await cover()
  await page.getByRole('button', { name: 'Barbearia' }).click()
  expect(await cover()).not.toBe(before)
  await expect(page.locator(shell)).toHaveAttribute('data-material', 'leather')
})

test('cor de baixo contraste mostra aviso', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByLabel('Cor principal').fill('#808080')
  await expect(page.getByText('A cor principal foi escurecida para o texto ficar legível.')).toBeVisible()
})

test('cor inválida mostra erro e mantém a prévia anterior', async ({ page }) => {
  await page.goto('/vitrine')
  const cover = () => page.locator(shell).evaluate((el) => getComputedStyle(el).getPropertyValue('--cover').trim())
  const before = await cover()
  await page.getByLabel('Cor principal').fill('azul')
  await expect(page.getByText(/Use uma cor no formato #RRGGBB/)).toBeVisible()
  expect(await cover()).toBe(before)
})

test('sem rolagem horizontal', async ({ page }) => {
  await page.goto('/vitrine')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('atalho Pet shop aplica linho e fonte amigável', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await expect(page.locator(shell)).toHaveAttribute('data-material', 'linen')
  await expect(page.locator(shell)).toHaveAttribute('data-font', 'friendly')
})

test('o diálogo da demonstração abre e fecha com Esc', async ({ page }) => {
  await page.goto('/vitrine')
  await page.locator(shell).getByRole('button', { name: 'Novo agendamento' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('o item de menu ativo tem aria-current', async ({ page }) => {
  await page.goto('/vitrine')
  const current = page.locator(shell).getByRole('navigation', { name: 'Principal' }).locator('[aria-current="page"]')
  await expect(current.first()).toBeAttached()
  await expect(current).toHaveCount(1)
})

test('no celular, a barra de divisórias fica na base e Mais abre a folha', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'só no celular')
  await page.goto('/vitrine')
  const nav = page.locator(shell).getByRole('navigation', { name: 'Principal' })
  await nav.scrollIntoViewIfNeeded()
  await expect(nav).toBeVisible()
  const box = await nav.boundingBox()
  const vh = page.viewportSize()!.height
  expect(box!.y + box!.height).toBeGreaterThan(vh - 4)
  await page.locator(shell).getByRole('button', { name: 'Mais' }).click()
  await expect(page.getByRole('dialog', { name: 'Mais' })).toBeVisible()
})

test('capturas para revisão', async ({ page }, info) => {
  await page.goto('/vitrine')
  // Em captura de página inteira o navegador não rola, então a barra "sticky" da base cairia em cima da capa.
  await page.addStyleTag({ content: '.af-shell__nav { position: static !important; }' })
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-padrao.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-petshop.png`, fullPage: true })
  await page.getByRole('button', { name: 'Barbearia' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-barbearia.png`, fullPage: true })
})
