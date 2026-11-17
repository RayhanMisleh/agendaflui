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

  test.each(['#1F2A44', '#808080', '#F2A93B'])('--on-accent tem 4,5 sobre --accent (%s)', (accent) => {
    const t = deriveTheme({ primary: '#0B6E66', accent, material: 'ENAMEL', paper: 'WHITE', fontPair: 'CLASSIC' })
    expect(contrastRatio(t.vars['--on-accent'], t.vars['--accent'])).toBeGreaterThanOrEqual(4.5)
  })
})

test('texto de estado da lâmpada e rótulo do medidor não usam opacity', () => {
  const fb = read('feedback.css')
  expect(decl(fb, '.af-lamp__state')).not.toMatch(/opacity/)
  expect(decl(fb, '.af-gauge__label')).not.toMatch(/opacity/)
})

describe('correção 2: textura, halo e hover', () => {
  const files = ['base.css', 'materials.css', 'controls.css', 'surfaces.css', 'feedback.css', 'data.css']

  /** Remove o conteúdo de todos os `@media (hover: hover) { ... }` (casando chaves). */
  function withoutHoverMedia(css: string): string {
    let out = ''
    let i = 0
    const marker = '@media (hover: hover)'
    for (;;) {
      const at = css.indexOf(marker, i)
      if (at < 0) return out + css.slice(i)
      out += css.slice(i, at)
      let depth = 0
      let j = css.indexOf('{', at)
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++
        else if (css[j] === '}' && --depth === 0) break
      }
      i = j + 1
    }
  }

  test.each(files)('%s: todo :hover fica dentro de @media (hover: hover)', (f) => {
    expect(withoutHoverMedia(read(f))).not.toMatch(/:hover/)
  })

  test('--fx sem cor relativa cai para transparent, não para preto', () => {
    expect(read('materials.css')).toMatch(/--fx:\s*transparent;/)
    expect(read('materials.css')).not.toMatch(/--fx:\s*#000;/)
  })

  test.each(['tex-grain', 'tex-leather', 'tex-wood', 'tex-metal'])(
    '--%s limita o alfa da textura a 0,25',
    (name) => {
      const css = read('materials.css')
      const m = new RegExp(`--${name}:\\s*url\\("data:image/svg\\+xml,([^"]+)"\\)`).exec(css)
      expect(m, name).not.toBeNull()
      const svg = decodeURIComponent(m![1]!)
      const table = /<feFuncA type='table' tableValues='([^']+)'/.exec(svg)
      expect(table, `${name} precisa de feFuncA table`).not.toBeNull()
      const max = Math.max(...table![1]!.trim().split(/\s+/).map(Number))
      expect(max).toBeLessThanOrEqual(0.25)
    },
  )

  test('utilitário .af-on-cover-text faz halo com --fx', () => {
    expect(decl(read('base.css'), '.af-on-cover-text')).toMatch(/text-shadow:[^;]*var\(--fx\)/)
  })

  test('texto secundário sobre capa usa o halo', () => {
    const fb = read('feedback.css')
    for (const sel of ['.af-lamp__state', '.af-gauge__label']) {
      const hit = blocks(fb).some(
        (b) => b.selector.includes(sel) && b.selector.includes('.af-cover') && /text-shadow:[^;]*var\(--fx\)/.test(b.body),
      )
      expect(hit, sel).toBe(true)
    }
  })
})
