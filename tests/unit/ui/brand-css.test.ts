import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../../../src')
const read = (f: string) => readFileSync(join(ROOT, 'ui/styles', f), 'utf8')
const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Arquivos de componente: tudo nasce dos tokens. */
const COMPONENTES = ['base.css', 'controls.css', 'surfaces.css', 'feedback.css', 'data.css']
/** Molduras, entrada e telas do painel dev (R3 e R4): as mesmas regras dos componentes. */
const MOLDURAS = ['shells.css', 'entry.css', 'account.css', 'overview.css', 'screens.css', 'wizard.css', 'painel.css']
/** Os seis arquivos de moldura e de tela que as etapas R3 e R4 refazem. */
const TELAS = ['shells.css', 'entry.css', 'account.css', 'overview.css', 'screens.css', 'wizard.css', 'painel.css']

describe('CSS dos componentes no desenho da marca', () => {
  test.each([...COMPONENTES, ...MOLDURAS])('%s: nenhuma cor fixa (só tokens)', (f) => {
    const css = semComentarios(read(f))
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|oklch)\(\s*[0-9]/)
  })

  test.each([...COMPONENTES, ...MOLDURAS])('%s: sem gradiente de fundo, sem textura e sem sombra que não seja a de quem flutua', (f) => {
    const css = semComentarios(read(f))
    expect(css).not.toMatch(/background(?:-image)?:[^;]*gradient\(/)
    expect(css).not.toMatch(/url\(\s*["']?data:/)
    const sombras = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim())
    for (const s of sombras) expect(s, f).toMatch(/^(none|var\(--shadow-pop\))$|^0 0 0 /)
  })

  test.each([...COMPONENTES, ...MOLDURAS])('%s: todo :hover fica dentro de @media (hover: hover)', (f) => {
    const css = semComentarios(read(f))
    let fora = ''
    let i = 0
    for (;;) {
      const at = css.indexOf('@media (hover: hover)', i)
      if (at < 0) {
        fora += css.slice(i)
        break
      }
      fora += css.slice(i, at)
      let fundo = 0
      let j = css.indexOf('{', at)
      for (; j < css.length; j++) {
        if (css[j] === '{') fundo++
        else if (css[j] === '}' && --fundo === 0) break
      }
      i = j + 1
    }
    expect(fora).not.toMatch(/:hover/)
  })

  test.each(MOLDURAS)('%s: sem vocabulário de papelaria nem anel de foco próprio', (f) => {
    const css = semComentarios(read(f))
    expect(css).not.toMatch(/data-material|\.af-(paper|stamp|lamp|statuslamp|counter|drum|gauge|matpick|raised|sunk|stitched|engraved|cover|material-metal|divider|on-cover-text)\b/)
    expect(css).not.toMatch(/:focus-visible\s*\{[^}]*outline:\s*\d/)
  })

  test('o movimento respeita prefers-reduced-motion', () => {
    const todo = COMPONENTES.map((f) => semComentarios(read(f))).join('\n')
    expect(todo).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(todo).toMatch(/@keyframes/)
  })

  test('a altura mínima de toque é de 44 px nos controles', () => {
    const controls = semComentarios(read('controls.css'))
    expect(controls).toMatch(/\.af-input\s*\{[^}]*min-height:\s*44px/)
    expect(controls).toMatch(/\.af-button--md\s*\{[^}]*min-height:\s*44px/)
  })

  test('foco: só o anel global; nenhum componente redefine o contorno', () => {
    for (const f of COMPONENTES) expect(semComentarios(read(f)), f).not.toMatch(/:focus-visible\s*\{[^}]*outline:\s*\d/)
  })

  test('o vocabulário de papelaria saiu do CSS de componentes e não há mais materials.css', () => {
    const arquivos = readdirSync(join(ROOT, 'ui/styles'))
    expect(arquivos).not.toContain('materials.css')
    expect(readFileSync(join(ROOT, 'ui/ui.css'), 'utf8')).not.toMatch(/materials/)
    for (const f of COMPONENTES) {
      expect(semComentarios(read(f)), f).not.toMatch(/data-material|\.af-(paper|stamp|lamp|statuslamp|counter|drum|gauge|matpick|raised|sunk|stitched|engraved|cover)\b/)
    }
  })

  test('as escalas antigas de base.css saíram', () => {
    expect(semComentarios(read('base.css'))).not.toMatch(/--(text-(xs|sm|md|lg|xl|2xl|3xl)|leading-|r-(key|slot|sheet|stamp|ticket|tab|lamp)|tap|ease-key):/)
  })
})

describe('CSS de molduras e telas (R3 e R4) sem nome de variável antigo', () => {
  const ANTIGOS =
    /var\(--(?:cover(?:-hi|-lo|-deep)?|on-cover(?:-soft)?|accent-hi|accent-lo|accent-ink|paper(?:-edge|-line|-sunk)?|ink-soft|ink-faint|ok|warn|bad|font-ui|font-stamp|text-(?:xs|sm|md|lg|xl|2xl|3xl)|leading-(?:tight|body)|r-(?:key|slot|sheet|stamp|ticket|tab|lamp)|tap|ease-key|tex-[a-z]+|fx)(?![\w-])/
  test.each(TELAS)('%s', (f) => {
    expect(semComentarios(read(f))).not.toMatch(ANTIGOS)
  })
})
