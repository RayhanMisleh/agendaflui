import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = join(process.cwd(), 'src/app/dev/(app)')

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivos(join(dir, e.name)) : [join(dir, e.name)],
  )
}
const todos = arquivos(RAIZ)
const rel = (f: string): string => relative(RAIZ, f).split('\\').join('/')
/** Tira comentários de linha e de bloco antes de procurar chamadas: um comentário não pode satisfazer o teste. */
const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const ler = (f: string): string => semComentarios(readFileSync(f, 'utf8'))
const nomeDe = (suffix: string): string[] => todos.filter((f) => f.endsWith(`/${suffix}`))

/** Páginas que não chamam `requirePlatformAdmin` direto: chamam um carregador da própria pasta que o chama (conferido abaixo). */
const CARREGADOR = 'carregarConta'
const CARREGADOR_ARQUIVO = join(RAIZ, 'contas/[id]/_data.ts')

/** Ações que não passam por `adminAction`, com o motivo. */
const SEM_ADMIN_ACTION: Record<string, string> = {
  'actions.ts#logoutAdmin': 'sair só revoga a sessão do cookie que veio na própria requisição; não lê nem escreve dado de outro',
}

/** Funções que montam ações e chamam `adminAction` por dentro (conferido abaixo). */
const FABRICAS: Record<string, string> = {
  porAlvo: join(RAIZ, '_lib/campos.ts'),
  porConta: join(RAIZ, 'contas/[id]/actions.ts'),
  porIntegracao: join(RAIZ, 'contas/[id]/integracoes/actions.ts'),
}

describe('painel dev: toda entrada exige admin', () => {
  test('a varredura encontra as páginas, ações e rotas esperadas', () => {
    expect(nomeDe('page.tsx').length).toBeGreaterThan(10)
    expect(nomeDe('actions.ts').length).toBeGreaterThan(5)
    expect(nomeDe('route.ts').length).toBeGreaterThan(0)
  })

  test('comentário não conta como chamada do guarda', () => {
    const src = "// requirePlatformAdmin()\n/* adminAction( */\nconst url = 'https://x.y'\nconst a = requirePlatformAdmin() // depois\n"
    const limpo = semComentarios(src)
    expect(limpo.match(/requirePlatformAdmin\(\)/g)).toHaveLength(1)
    expect(limpo).not.toContain('adminAction(')
    expect(limpo).toContain("'https://x.y'")
  })

  test('toda page.tsx chama requirePlatformAdmin, direto ou pelo carregador da conta', () => {
    for (const f of nomeDe('page.tsx')) {
      const src = ler(f)
      const direto = /requirePlatformAdmin\(\)/.test(src)
      const porCarregador = src.includes(`${CARREGADOR}(`) && f.startsWith(join(RAIZ, 'contas/[id]'))
      expect(direto || porCarregador, `${rel(f)} não chama requirePlatformAdmin`).toBe(true)
    }
  })

  test('o carregador da conta chama requirePlatformAdmin antes de ler a conta', () => {
    const src = ler(CARREGADOR_ARQUIVO)
    expect(src).toMatch(new RegExp(`export const ${CARREGADOR} = cache\\(`))
    expect(src.indexOf('requirePlatformAdmin()')).toBeGreaterThan(-1)
    expect(src.indexOf('requirePlatformAdmin()')).toBeLessThan(src.indexOf('getBusinessDetail('))
  })

  test('toda route.ts chama requirePlatformAdmin', () => {
    for (const f of nomeDe('route.ts')) expect(ler(f), `${rel(f)} não chama requirePlatformAdmin`).toMatch(/requirePlatformAdmin\(\)/)
  })

  test('as fábricas de ação passam por adminAction e adminAction chama requirePlatformAdmin primeiro', () => {
    for (const [nome, arquivo] of Object.entries(FABRICAS)) {
      const src = ler(arquivo)
      const inicio = src.search(new RegExp(`function ${nome}\\b`))
      expect(inicio, `${nome} não encontrada`).toBeGreaterThan(-1)
      expect(src.slice(inicio, inicio + 700), `${nome} não chama adminAction`).toContain('adminAction(')
    }
    const acao = ler(join(RAIZ, '_lib/action.ts'))
    const corpo = acao.slice(acao.indexOf('return async (prev, fd)'))
    expect(corpo.indexOf('requirePlatformAdmin()')).toBeGreaterThan(-1)
    expect(corpo.indexOf('requirePlatformAdmin()')).toBeLessThan(corpo.indexOf('parse(fd)'))
  })

  test('toda ação exportada de actions.ts passa por adminAction (ou por uma fábrica ou por situacao)', () => {
    const usados = new Set<string>()
    for (const f of nomeDe('actions.ts')) {
      const src = ler(f)
      expect(src.startsWith("'use server'"), `${rel(f)} sem 'use server'`).toBe(true)
      const partes = src.split(/^(?=export )/m).filter((p) => p.startsWith('export '))
      expect(partes.length, `${rel(f)} sem ações`).toBeGreaterThan(0)
      for (const p of partes) {
        const m = /^export (?:async function|const) (\w+)/.exec(p)
        expect(m, `export não reconhecido em ${rel(f)}: ${p.slice(0, 40)}`).not.toBeNull()
        const nome = m?.[1] ?? ''
        const chave = `${rel(f)}#${nome}`
        if (chave in SEM_ADMIN_ACTION) {
          usados.add(chave)
          continue
        }
        const passa = /\badminAction\b|\bporAlvo\(|\bporConta\(|\bporIntegracao\(|\bsituacao\(/.test(p)
        expect(passa, `${chave} não passa por adminAction`).toBe(true)
      }
    }
    // A lista de exceções não pode ter entrada sem uso.
    expect([...usados].sort()).toEqual(Object.keys(SEM_ADMIN_ACTION).sort())
  })
})
