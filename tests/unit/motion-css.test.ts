import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/ui')
const ARQUIVOS = ['ui.css', ...readdirSync(join(DIR, 'styles')).map((f) => `styles/${f}`)].filter((f) => f.endsWith('.css'))

type Regra = { prelude: string; body: string; contexto: string[] }

/** Percorre os blocos `prelude { corpo }` do CSS (sem comentários), guardando os @-blocos que envolvem cada regra. */
function regras(css: string, contexto: string[] = []): Regra[] {
  const out: Regra[] = []
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < texto.length) {
    const abre = texto.indexOf('{', i)
    if (abre === -1) break
    let fundo = 1
    let j = abre + 1
    while (j < texto.length && fundo > 0) {
      if (texto[j] === '{') fundo++
      else if (texto[j] === '}') fundo--
      j++
    }
    const prelude = texto.slice(i, abre).split(';').pop()!.trim()
    const body = texto.slice(abre + 1, j - 1)
    out.push({ prelude, body, contexto })
    if (prelude.startsWith('@')) out.push(...regras(body, [...contexto, prelude]))
    i = j
  }
  return out
}

const CSS = new Map(ARQUIVOS.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]))
const TODAS = [...CSS.entries()].flatMap(([arquivo, css]) => regras(css).map((r) => ({ ...r, arquivo })))
const MOTION = CSS.get('styles/motion.css') ?? ''

function declaracoes(body: string): [string, string][] {
  const semAninhados = body.replace(/\{[^{}]*\}/g, '')
  return semAninhados
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string])
}

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

test('nenhuma duração de movimento passa de 250ms (exceto af-spin e af-pulse)', () => {
  for (const r of TODAS.filter((x) => !x.prelude.startsWith('@'))) {
    for (const [prop, valor] of declaracoes(r.body)) {
      if (!/^(animation|transition)$/.test(prop)) continue
      if (/af-spin|af-pulse/.test(valor)) continue
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
