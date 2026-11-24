import { readdirSync, readFileSync } from 'node:fs'
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

  test('nenhuma classe-base é definida em dois arquivos de estilo (uma tela herdava a altura de outra)', () => {
    const dir = join(__dirname, '../../../src/ui/styles')
    const donos = new Map<string, Set<string>>()
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      for (const m of css(f).matchAll(/^ {2}(\.af-[a-z0-9_-]+) \{/gm)) {
        const seletor = m[1]!
        donos.set(seletor, (donos.get(seletor) ?? new Set()).add(f))
      }
    }
    const repetidas = [...donos].filter(([, arquivos]) => arquivos.size > 1).map(([seletor]) => seletor)
    expect(repetidas).toEqual([])
  })
})
