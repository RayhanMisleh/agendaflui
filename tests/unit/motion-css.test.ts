import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { declaracoes, keyframes, regras, scanCss } from '../setup/css-scan'

const DIR = join(process.cwd(), 'src/ui')
const ARQUIVOS = ['ui.css', ...readdirSync(join(DIR, 'styles')).map((f) => `styles/${f}`)].filter((f) => f.endsWith('.css'))

const CSS = new Map(ARQUIVOS.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]))
const TODAS = [...CSS.entries()].flatMap(([arquivo, css]) => regras(css).map((r) => ({ ...r, arquivo })))
const MOTION = CSS.get('styles/motion.css') ?? ''

const VARS = new Map(declaracoes(regras(MOTION).find((r) => r.prelude === ':root')?.body ?? '').filter(([p]) => p.startsWith('--')))
const resolve = (v: string) => v.replace(/var\((--[\w-]+)\)/g, (_, n: string) => VARS.get(n) ?? '')
const semMovimento = (c: string[]) => c.some((m) => /prefers-reduced-motion:\s*no-preference/.test(m))
const NAO_MEXE = /transform|translate|scale|rotate/

test('ui.css importa motion.css por último', () => {
  const imports = [...(CSS.get('ui.css') ?? '').matchAll(/@import '([^']+)'/g)].map((m) => m[1])
  expect(imports.at(-1)).toBe('./styles/motion.css')
})

test('motion.css define as durações e a curva', () => {
  expect(VARS.get('--af-dur-fast')).toBe('150ms')
  expect(VARS.get('--af-dur')).toBe('200ms')
  expect(VARS.get('--af-dur-slow')).toBe('250ms')
  expect(VARS.get('--af-ease')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
})

test('todo @keyframes anima só transform e opacity', () => {
  const quadros = TODAS.filter((r) => r.prelude.startsWith('@keyframes'))
  expect(quadros.length).toBeGreaterThan(0)
  for (const q of quadros) {
    for (const passo of regras(q.body)) {
      for (const [prop] of declaracoes(passo.body)) {
        expect(['transform', 'opacity'], `${q.prelude} / ${passo.prelude} usa ${prop}`).toContain(prop)
      }
    }
  }
})

test('toda animation fica sob prefers-reduced-motion: no-preference', () => {
  for (const r of TODAS.filter((x) => !x.prelude.startsWith('@'))) {
    for (const [prop, valor] of declaracoes(r.body)) {
      if (!/^animation(-name)?$/.test(prop) || valor === 'none') continue
      expect(semMovimento(r.contexto), `${r.prelude} (${r.arquivo}) anima fora de no-preference`).toBe(true)
    }
  }
})

test('transition que move é só para no-preference ou é anulada em reduce', () => {
  const anuladas = new Set(
    TODAS.filter((r) => r.contexto.some((m) => /prefers-reduced-motion:\s*reduce/.test(m)) && declaracoes(r.body).some(([p, v]) => p === 'transition' && v === 'none')).flatMap((r) =>
      r.prelude.split(',').map((s) => s.trim()),
    ),
  )
  for (const r of TODAS.filter((x) => !x.prelude.startsWith('@'))) {
    for (const [prop, valor] of declaracoes(r.body)) {
      if (prop !== 'transition' || !NAO_MEXE.test(valor)) continue
      if (semMovimento(r.contexto)) continue
      for (const seletor of r.prelude.split(',').map((s) => s.trim())) {
        expect(anuladas.has(seletor), `${seletor} (${r.arquivo}) move sem no-preference nem reduce`).toBe(true)
      }
    }
  }
})

test('motion.css anula a duração das view transitions em reduce', () => {
  const reduce = regras(MOTION).find((r) => /prefers-reduced-motion:\s*reduce/.test(r.prelude))
  expect(reduce).toBeDefined()
  expect(reduce!.body).toMatch(/::view-transition-old\(\*\)/)
  expect(reduce!.body).toMatch(/::view-transition-new\(\*\)/)
  expect(reduce!.body).toMatch(/animation-duration:\s*0s\s*!important/)
})

test('motion.css deixa os cliques passarem durante a transição', () => {
  expect(MOTION).toMatch(/::view-transition\s*\{[^}]*pointer-events:\s*none/)
})

test('nenhuma duração de movimento passa de 250ms (exceto af-spin, af-pulse e as bolhas da celebração, 1,2 s uma vez só)', () => {
  for (const r of TODAS.filter((x) => !x.prelude.startsWith('@'))) {
    for (const [prop, valor] of declaracoes(r.body)) {
      if (!/^(animation|transition)$/.test(prop)) continue
      if (/af-spin|af-pulse|af-cl-bubble-up/.test(valor)) continue
      for (const parte of resolve(valor).split(/,(?![^(]*\))/)) {
        const tempo = /(\d+(?:\.\d+)?)(ms|s)\b/.exec(parte)
        if (!tempo) continue
        const ms = Number(tempo[1]) * (tempo[2] === 's' ? 1000 : 1)
        expect(ms, `${r.prelude} (${r.arquivo}): ${parte.trim()}`).toBeLessThanOrEqual(250)
      }
    }
  }
})

test('motion.css nomeia a barra do topo e a pílula do celular para ficarem acima da página durante a troca', () => {
  const celular = regras(MOTION).find((r) => /max-width:\s*767\.98px/.test(r.prelude))
  expect(celular, 'falta o bloco do celular').toBeDefined()
  expect(celular!.body).toMatch(/\.af-shell__top\s*\{[^}]*view-transition-name:\s*af-top/)
  expect(celular!.body).toMatch(/\.af-shell__nav\s*\{[^}]*view-transition-name:\s*af-nav/)
  const regra = (parte: string, nome: string) => regras(MOTION).find((r) => !r.prelude.startsWith('@') && r.prelude.includes(`::view-transition-${parte}(${nome})`))
  for (const nome of ['af-top', 'af-nav']) {
    expect(regra('group', nome)?.body, nome).toMatch(/animation:\s*none[\s\S]*z-index:\s*100/)
    expect(regra('old', nome)?.body, nome).toMatch(/display:\s*none/)
    expect(regra('new', nome)?.body, nome).toMatch(/animation:\s*none/)
  }
})

test('o esqueleto não leva nome de transição: todo nome exclui .af-shell--skeleton (evita nome duplicado com a moldura)', () => {
  expect(regras(MOTION).filter((r) => !r.prelude.startsWith('@') && /view-transition-name/.test(r.body)).every((r) => /:not\(\.af-shell--skeleton\)/.test(r.prelude))).toBe(true)
})

// ---- Regras estritas de movimento: valem para todos os arquivos de src/ui ----
const SO_TRANSFORM = /^(transform|opacity|translate|scale)$/
/** `display` e `overlay` com `allow-discrete` só seguram o diálogo na tela até a saída acabar: não animam nada. */
const DISCRETA = (parte: string) => /^(display|overlay)\s.*allow-discrete/.test(parte.trim())
const DECLARACOES = [...CSS.entries()].flatMap(([arquivo, css]) => scanCss(css).map((d) => ({ ...d, arquivo })))
const MOVIMENTO = DECLARACOES.filter((d) => /^(transition|transition-property|animation)$/.test(d.prop) && d.value !== 'none')
const ondeEsta = (d: { selector: string; arquivo: string }) => `${d.selector} (${d.arquivo})`

test('toda transition/animation diferente de none fica dentro de @media (prefers-reduced-motion: no-preference)', () => {
  expect(MOVIMENTO.length).toBeGreaterThan(5)
  const fora = MOVIMENTO.filter((d) => !semMovimento(d.media)).map(ondeEsta)
  expect(fora).toEqual([])
})

test('transition só de transform, opacity, translate ou scale', () => {
  const erradas = MOVIMENTO.filter((d) => d.prop === 'transition' || d.prop === 'transition-property')
    .filter((d) =>
      resolve(d.value)
        .split(/,(?![^(]*\))/)
        .some((parte) => !DISCRETA(parte) && !SO_TRANSFORM.test(parte.trim().split(/\s+/)[0] ?? '')),
    )
    .map((d) => `${ondeEsta(d)}: ${d.value}`)
  expect(erradas).toEqual([])
})

test('@keyframes só mexem em transform, opacity, translate ou scale', () => {
  const erradas = Object.entries(Object.assign({}, ...[...CSS.values()].map(keyframes)) as Record<string, string[]>).flatMap(([nome, props]) =>
    props.filter((p) => !SO_TRANSFORM.test(p)).map((p) => `${nome}: ${p}`),
  )
  expect(erradas).toEqual([])
})

test('durações de transition e animation usam var(--af-dur…)', () => {
  const erradas = MOVIMENTO.filter((d) => !/af-spin|af-pulse|af-cl-bubble-up/.test(d.value) && !/var\(--af-dur/.test(d.value) && d.prop !== 'transition-property').map((d) => `${ondeEsta(d)}: ${d.value}`)
  expect(erradas).toEqual([])
})
