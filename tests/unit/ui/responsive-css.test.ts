import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = (f: string) => readFileSync(join(__dirname, '../../../src/ui/styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('responsivo: regras que não podem se perder', () => {
  test('a ficha da agenda se adapta à altura por consulta de contêiner (curta, média e alta)', () => {
    const planner = css('planner.css')
    expect(planner).toMatch(/\.af-slip__box\s*\{[^}]*container:\s*af-slip\s*\/\s*size/)
    expect(planner.match(/@container af-slip/g)?.length).toBeGreaterThanOrEqual(3)
  })

  test('a tabela de dados vira lista de cartões no contêiner estreito e tem largura mínima por coluna', () => {
    const data = css('data.css')
    expect(data).toMatch(/\.af-datalist\s*\{[^}]*container:\s*af-datalist\s*\/\s*inline-size/)
    expect(data).toMatch(/--dl-col-min:/)
    expect(data).toMatch(/\.af-clamp\s*\{[^}]*-webkit-line-clamp:\s*2/)
  })

  test('campos de texto têm 16 px no mínimo (sem zoom automático no iOS)', () => {
    const controls = css('controls.css')
    expect(controls).toMatch(/@media \(pointer: coarse\)/)
  })
})
