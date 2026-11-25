import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const AREAS = {
  painel: 'src/app/app/painel',
  dev: 'src/app/dev/(app)',
  conta: 'src/app/app/conta',
}
const MOLDURAS = /\b(PainelShell|DevShell|AccountShell|ShellFrame|PainelFrame|DevFrame)\b/

function arquivos(dir: string, nome: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name)
    if (e.isDirectory()) return arquivos(caminho, nome)
    return nome.test(e.name) ? [caminho] : []
  })
}

describe('a moldura mora no layout, nunca na página', () => {
  test.each(Object.entries(AREAS))('layout de %s desenha a moldura', (_, pasta) => {
    const layout = join(RAIZ, pasta, 'layout.tsx')
    expect(existsSync(layout), `falta ${layout}`).toBe(true)
    expect(readFileSync(layout, 'utf8')).toMatch(MOLDURAS)
  })

  test.each(Object.entries(AREAS))('nenhuma page, loading, error ou not-found de %s traz a moldura', (_, pasta) => {
    const dentro = arquivos(join(RAIZ, pasta), /^(page|loading|error|not-found)\.tsx$/)
    expect(dentro.length).toBeGreaterThan(0)
    for (const arquivo of dentro) expect(readFileSync(arquivo, 'utf8'), arquivo).not.toMatch(MOLDURAS)
  })

  test('as páginas usam ShellPage (cabeçalho e transição só do miolo)', () => {
    const paginas = [...arquivos(join(RAIZ, AREAS.painel), /^page\.tsx$/), ...arquivos(join(RAIZ, AREAS.dev), /^page\.tsx$/)]
    // As abas de uma conta (contas/[id]/*) vivem dentro do layout da conta, que já desenha a página.
    const sem = paginas.filter((p) => !/contas\/\[id\]\//.test(p) && !/ShellPage|redirect\(/.test(readFileSync(p, 'utf8')))
    expect(sem).toEqual([])
  })
})
