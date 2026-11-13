import { readFileSync } from 'node:fs'
import { contrastRatio } from '@/ui/theme/color'
import { deriveTheme } from '@/ui/theme/derive'

const read = (f: string) =>
  readFileSync(new URL(`../../../src/ui/styles/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Blocos `seletor { ... }` do CSS (sem aninhamento relevante para estes arquivos). */
function blocks(css: string): Array<{ selector: string; body: string }> {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, ' '),
    body: m[2]!,
  }))
}
const decl = (css: string, selector: string) =>
  blocks(css).find((b) => b.selector.split(',').map((s) => s.trim()).includes(selector))?.body ?? ''

const GRADIENT = /linear-gradient\(\s*180deg,\s*([^,]+?) 0,\s*([^,]+?) 12%,\s*([^,]+?) 88%,\s*([^,]+?) 100%\s*\)/
const transparent = (c: string) => /\/\s*0\)$/.test(c.trim())

describe('texto das teclas fica sobre a cor lisa', () => {
  const controls = read('controls.css')

  test.each(['.af-button', '.af-button--secondary', '.af-tab'])(
    '%s: realce só nos 12% das pontas, faixa central transparente',
    (sel) => {
      const m = GRADIENT.exec(decl(controls, sel))
      expect(m, `${sel} precisa de gradiente 0 / 12% / 88% / 100%`).not.toBeNull()
      expect(transparent(m![2]!)).toBe(true)
      expect(transparent(m![3]!)).toBe(true)
    },
  )

  test('hover e ativo não mexem no fundo', () => {
    const states = blocks(controls).filter(
      (b) => /\.af-(button|tab)[^ ]*:(hover|active)/.test(b.selector) && !b.selector.includes('--active'),
    )
    expect(states.length).toBeGreaterThan(0)
    for (const b of states) expect(b.body, b.selector).not.toMatch(/background/)
  })

  test.each(['#1F2A44', '#808080', '#E0A030'])('--on-accent tem 4,5 sobre --accent (%s)', (accent) => {
    const t = deriveTheme({ primary: '#0E4F5C', accent, material: 'ENAMEL', paper: 'WHITE', fontPair: 'CLASSIC' })
    expect(contrastRatio(t.vars['--on-accent'], t.vars['--accent'])).toBeGreaterThanOrEqual(4.5)
  })
})

test('texto de estado da lâmpada e rótulo do medidor não usam opacity', () => {
  const fb = read('feedback.css')
  expect(decl(fb, '.af-lamp__state')).not.toMatch(/opacity/)
  expect(decl(fb, '.af-gauge__label')).not.toMatch(/opacity/)
})
