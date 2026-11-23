import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = join(__dirname, '../..')

function arquivos(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho, ext) : ext.test(nome) ? [caminho] : []
  })
}

/** Telas varridas: o painel do negócio (T15) e o painel dev (T16). */
const TELAS = ['src/app/painel', 'src/app/dev']

/**
 * `<table>` que pode ficar fora do DataList, com o motivo (Ruling A8): a matriz de permissões e avisos é uma grade de
 * caixas de marcar, não uma lista de dados; ela continua tabela e rola dentro de um contêiner (`af-matrix__scroll`).
 */
const TABELAS_PERMITIDAS: Record<string, string> = {
  'src/app/painel/(app)/configuracoes/Formularios.tsx': 'matriz de avisos por canal, com rolagem em contêiner',
  'src/app/dev/(app)/contas/[id]/FormsConta.tsx': 'matriz de avisos por canal, com rolagem em contêiner',
}

describe('tabelas das telas', () => {
  test.each(TELAS)('%s: nenhum <table> solto; listas usam DataList', (pasta) => {
    const soltas = arquivos(join(RAIZ, pasta), /\.tsx$/)
      .filter((f) => /<table[\s>]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RAIZ, f))
      .filter((f) => !(f in TABELAS_PERMITIDAS))
    expect(soltas).toEqual([])
  })

  test('a matriz permitida fica dentro de um contêiner que rola', () => {
    for (const f of Object.keys(TABELAS_PERMITIDAS)) {
      const src = readFileSync(join(RAIZ, f), 'utf8')
      expect(src, f).toMatch(/<div className="af-matrix__scroll">\s*<table className="af-matrix">/)
    }
  })
})

/** Larguras fixas acima de 22,5 rem (360 px) que o CSS pode ter fora de @media, com o motivo. */
const ALLOWED: Record<string, string> = {}

const LIMITE_PX = 360
function emPx(valor: string): number | null {
  const m = /^(-?[0-9.]+)(rem|px)$/.exec(valor.trim())
  if (!m) return null
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])
}

/** Declarações de largura fixa (`width`, `min-width`, `flex-basis`) que estão fora de qualquer @media/@container. */
function largurasFixas(css: string): string[] {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const achados: string[] = []
  const pilha: boolean[] = [] // verdadeiro quando o bloco é @media ou @container
  let cabeca = ''
  for (const ch of semComentarios) {
    if (ch === '{') {
      pilha.push(/^\s*@(media|container)/.test(cabeca))
      cabeca = ''
    } else if (ch === '}') {
      pilha.pop()
      cabeca = ''
    } else if (ch === ';') {
      const m = /^\s*(min-width|width|flex-basis|inline-size|min-inline-size)\s*:\s*(.+)$/.exec(cabeca)
      if (m && !pilha.some(Boolean)) {
        const px = emPx(m[2]!)
        if (px !== null && px > LIMITE_PX) achados.push(`${m[1]}: ${m[2]!.trim()}`)
      }
      cabeca = ''
    } else cabeca += ch
  }
  return achados
}

describe('larguras fixas no CSS', () => {
  const css = [...arquivos(join(RAIZ, 'src/ui/styles'), /\.css$/), join(RAIZ, 'src/ui/ui.css')]
  test.each(css.map((f) => relative(RAIZ, f)))('%s: nada de largura fixa acima de 22,5 rem fora de @media', (f) => {
    if (f in ALLOWED) return
    expect(largurasFixas(readFileSync(join(RAIZ, f), 'utf8'))).toEqual([])
  })

  test('o detector enxerga uma largura fixa e ignora min(), max-width e @media', () => {
    expect(largurasFixas('.a { width: 30rem; }')).toEqual(['width: 30rem'])
    expect(largurasFixas('.a { width: min(30rem, 100%); max-width: 40rem; }')).toEqual([])
    expect(largurasFixas('@media (min-width: 40rem) { .a { min-width: 30rem; } }')).toEqual([])
  })
})

describe('formulários', () => {
  test('a grade de formulário do painel fica em uma coluna abaixo de 40rem', () => {
    const css = readFileSync(join(RAIZ, 'src/ui/styles/painel.css'), 'utf8')
    const bloco = /@media \(min-width: ([0-9.]+rem)\)\s*\{\s*\.af-formgrid\s*\{/.exec(css)
    expect(bloco?.[1]).toBe('40rem')
  })
})
