import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { demoEmail } from '../../prisma/seed-data'

const DEV = `http://${process.env.DEV_HOST || 'dev.localhost:3000'}`
const PAINEL = `http://${process.env.PAINEL_HOST || 'painel.localhost:3000'}`

const adminEmail = () => process.env.SEED_ADMIN_EMAIL!
const adminSenha = () => process.env.SEED_ADMIN_PASSWORD!
const senhaUsuarios = () => process.env.SEED_USER_PASSWORD!

/** Espera a hidratação: preencher antes dela faz a tela perder o que foi digitado. */
async function hidratado(page: Page) {
  await page.waitForFunction(() => {
    const b = document.querySelector('form button')
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'))
  })
}

async function preencher(page: Page, email: string, senha: string) {
  await hidratado(page)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function entrarNoPainel(page: Page, email: string, slug?: string) {
  await page.goto(slug ? `${PAINEL}/entrar/${slug}` : `${PAINEL}/entrar`)
  await preencher(page, email, senhaUsuarios())
  await expect(page).toHaveURL(`${PAINEL}/`)
}

test('admin entra no painel dev e vê as contas', async ({ page }) => {
  await page.goto(`${DEV}/`)
  await expect(page).toHaveURL(`${DEV}/entrar`)
  await preencher(page, adminEmail(), adminSenha())
  await expect(page.getByText('Patas & Cia').filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('Navalha de Ouro').filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Vitrine de componentes' })).toBeVisible()
})

test('senha errada mostra erro, mantém o e-mail e não entra', async ({ page }, info) => {
  // E-mail único por execução: o limite de tentativas é por e-mail e fica guardado no servidor.
  const email = `quase.${info.project.name}.${Date.now()}@agendaflui.localhost`
  await page.goto(`${DEV}/entrar`)
  await preencher(page, email, 'senha-errada-123')
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()
  await expect(page.getByLabel('E-mail')).toHaveValue(email)
  await expect(page.getByLabel('Senha')).toHaveValue('')
  await expect(page).toHaveURL(`${DEV}/entrar`)
})

test('tentativas demais mostram o limite', async ({ page }, info) => {
  await page.goto(`${DEV}/entrar`)
  const email = `limite.${info.project.name}.${Date.now()}@agendaflui.localhost`
  for (let i = 0; i < 6; i++) {
    const resposta = page.waitForResponse((r) => r.request().method() === 'POST')
    await preencher(page, email, 'senha-errada-123')
    await resposta
    // O React limpa o formulário quando a action termina; só digita de novo depois disso.
    await expect(page.getByRole('button', { name: 'Entrar' })).not.toHaveAttribute('aria-busy', 'true')
    if (i < 5) await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()
  }
  await expect(page.getByText(/^Muitas tentativas\. Tente de novo em/)).toBeVisible()
})

test('link de entrada da conta já vem com a marca dela', async ({ page }) => {
  await page.goto(`${PAINEL}/entrar/patas-e-cia`)
  await expect(page.getByText('Patas & Cia')).toBeVisible()
  await expect(page.locator('[data-material="linen"]').first()).toBeVisible()
})

test('slug inexistente é 404', async ({ page }) => {
  expect((await page.goto(`${PAINEL}/entrar/nao-existe`))?.status()).toBe(404)
})

test('dono de duas contas escolhe, entra, e a entrada passa a lembrar a marca', async ({ page }) => {
  await page.goto(`${PAINEL}/entrar`)
  await preencher(page, process.env.SEED_MULTI_EMAIL!, senhaUsuarios())
  await expect(page).toHaveURL(`${PAINEL}/escolher-conta`)
  await page.getByRole('button', { name: /Navalha de Ouro/ }).click()
  await expect(page.locator('[data-material="leather"]').first()).toBeVisible()
  await expect(page.getByText('Barbeiros')).toBeVisible()
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(`${PAINEL}/entrar`)
  await expect(page.getByText('Navalha de Ouro')).toBeVisible()
})

test('sessão do painel dev não vale no painel do negócio', async ({ page }) => {
  await page.goto(`${DEV}/entrar`)
  await preencher(page, adminEmail(), adminSenha())
  await expect(page).toHaveURL(`${DEV}/`)
  await page.goto(`${PAINEL}/`)
  await expect(page).toHaveURL(`${PAINEL}/entrar`)
})

test('painel do negócio não alcança rotas do painel dev', async ({ page }) => {
  expect((await page.goto(`${PAINEL}/dev/entrar`))?.status()).toBe(404)
})

test('profissional entra e vê a própria conta, com a marca dela', async ({ page }) => {
  await entrarNoPainel(page, demoEmail('navalha', 'profissional'), 'navalha-de-ouro')
  await expect(page.locator('[data-material="leather"]').first()).toBeVisible()
  await expect(page.getByText('Olá, Davi')).toBeVisible()
  await expect(page.getByText('Barbeiros')).toBeVisible()
  await expect(page.getByText('Patas & Cia')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Trocar de conta' })).toHaveCount(0)
  const atual = page.getByRole('navigation', { name: 'Principal' }).locator('[aria-current="page"]')
  await expect(atual).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Principal' }).locator('[aria-disabled="true"]').first()).toBeAttached()
})

test('sessão revogada em outra aba leva de volta a /entrar', async ({ page, context }) => {
  await entrarNoPainel(page, demoEmail('patas', 'gerente'))
  const original = (await context.cookies()).find((c) => c.name === 'af_painel_session')!
  expect(original.httpOnly).toBe(true)
  const outra = await context.newPage()
  await outra.goto(`${PAINEL}/`)
  await outra.getByRole('button', { name: 'Sair' }).click()
  await expect(outra).toHaveURL(`${PAINEL}/entrar`)
  // O cookie antigo volta ao navegador, mas a sessão já foi revogada no banco.
  await context.addCookies([original])
  await page.goto(`${PAINEL}/`)
  await expect(page).toHaveURL(`${PAINEL}/entrar`)
})

test('sem cookie, o painel volta para /entrar', async ({ page, context }) => {
  await entrarNoPainel(page, demoEmail('patas', 'dono'))
  await context.clearCookies()
  await page.goto(`${PAINEL}/`)
  await expect(page).toHaveURL(`${PAINEL}/entrar`)
})

test('/escolher-conta só lista contas de que o usuário é membro', async ({ page }) => {
  await entrarNoPainel(page, demoEmail('patas', 'dono'))
  await page.goto(`${PAINEL}/escolher-conta`)
  await expect(page.getByRole('button', { name: /Patas & Cia/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Navalha de Ouro/ })).toHaveCount(0)
  await expect(page.getByText('Navalha de Ouro')).toHaveCount(0)
})

test('a página inicial mostra a data no fuso da conta', async ({ page }) => {
  await entrarNoPainel(page, demoEmail('navalha', 'dono'))
  const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())
  await expect(page.getByText('Olá, Rafael')).toBeVisible()
  await expect(page.getByText(hoje)).toBeVisible()
  await expect(page.getByText('Você entra como Dono')).toBeVisible()
})

test('as telas de entrada a 375 px não têm rolagem horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const semRolagem = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  for (const url of [`${DEV}/entrar`, `${PAINEL}/entrar`, `${PAINEL}/entrar/patas-e-cia`, `${PAINEL}/entrar/navalha-de-ouro`]) {
    await page.goto(url)
    expect(await semRolagem(), url).toBe(true)
  }
  await page.goto(`${PAINEL}/entrar`)
  await preencher(page, process.env.SEED_MULTI_EMAIL!, senhaUsuarios())
  await expect(page).toHaveURL(`${PAINEL}/escolher-conta`)
  expect(await semRolagem(), 'escolher-conta').toBe(true)
})

test('as telas de entrada e a escolha de conta carregam sem erro de console', async ({ page }) => {
  const problemas: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problemas.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`))
  for (const url of [`${DEV}/entrar`, `${PAINEL}/entrar`, `${PAINEL}/entrar/patas-e-cia`, `${PAINEL}/entrar/navalha-de-ouro`]) {
    await page.goto(url)
    await hidratado(page)
  }
  await preencher(page, process.env.SEED_MULTI_EMAIL!, senhaUsuarios())
  await expect(page).toHaveURL(`${PAINEL}/escolher-conta`)
  await page.getByRole('button', { name: /Patas & Cia/ }).click()
  await expect(page).toHaveURL(`${PAINEL}/`)
  await page.waitForTimeout(300)
  expect(problemas).toEqual([])
})

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('o formulário de entrada do painel dev funciona', async ({ page }) => {
    await page.goto(`${DEV}/entrar`)
    await page.getByLabel('E-mail').fill(adminEmail())
    await page.getByLabel('Senha').fill(adminSenha())
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(`${DEV}/`)
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible()
  })
})
