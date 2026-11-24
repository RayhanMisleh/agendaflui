import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAINEL = join(process.cwd(), 'src/app/app/painel')

function pastas(dir: string): string[] {
  const filhos = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  return [dir, ...filhos.flatMap((e) => pastas(join(dir, e.name)))]
}

const COM_PAGINA = pastas(PAINEL).filter((d) => existsSync(join(d, 'page.tsx')))

test('a varredura acha as telas do painel', () => {
  expect(COM_PAGINA.length).toBeGreaterThan(20)
})

test.each(COM_PAGINA.map((d) => d.slice(PAINEL.length) || '/'))('toda pasta de src/app/app/painel com page.tsx tem loading.tsx: %s', (rel) => {
  const dir = join(PAINEL, rel === '/' ? '' : rel)
  const arquivo = join(dir, 'loading.tsx')
  expect(existsSync(arquivo), `falta ${arquivo}`).toBe(true)
  expect(readFileSync(arquivo, 'utf8')).toContain('ShellSkeleton')
})
