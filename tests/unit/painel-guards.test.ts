import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = join(process.cwd(), 'src/app/painel/(app)')

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(join(dir, e.name)) : [join(dir, e.name)]))
}
const todos = arquivos(RAIZ)
const rel = (f: string): string => relative(RAIZ, f).split('\\').join('/')
/** Tira comentários de linha e de bloco antes de procurar chamadas: um comentário não pode satisfazer o teste. */
const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const ler = (f: string): string => semComentarios(readFileSync(f, 'utf8'))
const nomeDe = (suffix: string): string[] => todos.filter((f) => f.endsWith(`/${suffix}`) || f === join(RAIZ, suffix))

/** Páginas e rotas que não chamam `requireTenant` direto, com o motivo (nenhuma hoje). */
const SEM_GUARDA: Record<string, string> = {}

/** Ações que não passam por `tenantAction`, com o motivo (nenhuma hoje). */
const SEM_TENANT_ACTION: Record<string, string> = {}

describe('painel do negócio: toda entrada exige uma conta ativa', () => {
  test('a varredura encontra as páginas, ações e rotas esperadas', () => {
    expect(nomeDe('page.tsx').length).toBeGreaterThanOrEqual(10)
    expect(nomeDe('actions.ts').length).toBeGreaterThanOrEqual(5)
    expect(nomeDe('route.ts').length).toBeGreaterThanOrEqual(3)
  })

  test('comentário não conta como chamada do guarda', () => {
    const src = "// requireTenant()\n/* tenantAction( */\nconst url = 'https://x.y'\nconst a = requireTenant() // depois\n"
    const limpo = semComentarios(src)
    expect(limpo.match(/requireTenant\(/g)).toHaveLength(1)
    expect(limpo).not.toContain('tenantAction(')
    expect(limpo).toContain("'https://x.y'")
  })

  test('toda page.tsx chama requireTenant', () => {
    for (const f of nomeDe('page.tsx')) {
      if (rel(f) in SEM_GUARDA) continue
      expect(ler(f), `${rel(f)} não chama requireTenant`).toMatch(/\brequireTenant\(/)
    }
  })

  test('todo route.ts chama requireTenant antes de tocar em dado', () => {
    for (const f of nomeDe('route.ts')) {
      if (rel(f) in SEM_GUARDA) continue
      const src = ler(f)
      const aqui = src.search(/\brequireTenant\(/)
      expect(aqui, `${rel(f)} não chama requireTenant`).toBeGreaterThan(-1)
      // Nenhuma chamada de domínio nem leitura do corpo vem antes do guarda.
      expect(src.slice(0, aqui), `${rel(f)} lê dado antes do guarda`).not.toMatch(/\bawait request\.|formData\(|\.json\(\)|ctx\./)
    }
  })

  test('tenantAction chama requireTenant antes de ler o formulário', () => {
    const src = ler(join(RAIZ, '_lib/action.ts'))
    const corpo = src.slice(src.indexOf('return async (prev, fd)'))
    expect(corpo.indexOf('requireTenant()')).toBeGreaterThan(-1)
    expect(corpo.indexOf('requireTenant()')).toBeLessThan(corpo.indexOf('parse(fd)'))
    expect(corpo.indexOf('requireTenant()')).toBeLessThan(corpo.indexOf('run(ctx'))
  })

  test('toda ação exportada de actions.ts passa por tenantAction', () => {
    const usados = new Set<string>()
    for (const f of nomeDe('actions.ts')) {
      const src = ler(f)
      expect(src.startsWith("'use server'"), `${rel(f)} sem 'use server'`).toBe(true)
      const partes = src.split(/^(?=export )/m).filter((p) => p.startsWith('export '))
      expect(partes.length, `${rel(f)} sem ações`).toBeGreaterThan(0)
      for (const p of partes) {
        const m = /^export (?:async function|const) (\w+)/.exec(p)
        expect(m, `export não reconhecido em ${rel(f)}: ${p.slice(0, 40)}`).not.toBeNull()
        const chave = `${rel(f)}#${m?.[1] ?? ''}`
        if (chave in SEM_TENANT_ACTION) {
          usados.add(chave)
          continue
        }
        expect(/\btenantAction\(/.test(p), `${chave} não passa por tenantAction`).toBe(true)
      }
    }
    // A lista de exceções não pode ter entrada sem uso.
    expect([...usados].sort()).toEqual(Object.keys(SEM_TENANT_ACTION).sort())
  })

  test('toda função exportada de um arquivo "use server" que não é actions.ts chama requireTenant primeiro', () => {
    const outros = todos.filter((f) => f.endsWith('.ts') && !f.endsWith('/actions.ts') && ler(f).trimStart().startsWith("'use server'"))
    expect(outros.map(rel)).toContain('agenda/consultas.ts')
    for (const f of outros) {
      const src = ler(f)
      const funcoes = src.split(/^(?=export async function )/m).filter((p) => p.startsWith('export async function '))
      expect(funcoes.length, `${rel(f)} sem funções`).toBeGreaterThan(0)
      for (const p of funcoes) {
        const nome = /^export async function (\w+)/.exec(p)?.[1] ?? '?'
        const aqui = p.indexOf('requireTenant()')
        expect(aqui, `${rel(f)}#${nome} não chama requireTenant`).toBeGreaterThan(-1)
        // Antes do guarda só cabe o próprio `await` dele: nada de ler, gravar nem devolver.
        const antes = p.slice(0, aqui)
        expect(antes.match(/\bawait\b/g) ?? [], `${rel(f)}#${nome} faz algo antes do guarda`).toHaveLength(1)
        expect(antes, `${rel(f)}#${nome} devolve antes do guarda`).not.toMatch(/\breturn\b/)
      }
    }
  })

  test('toda page.tsx dos três módulos chama requirePainelModule do módulo certo, depois de requireTenant', () => {
    const MODULOS: Record<string, string> = { fidelidade: 'loyalty', banners: 'banners', loja: 'store' }
    for (const [pasta, modulo] of Object.entries(MODULOS)) {
      const doModulo = todos.filter((f) => rel(f).startsWith(`${pasta}/`) && /\/page\.tsx$/.test(rel(f)))
      expect(doModulo.length, `${pasta} sem páginas`).toBeGreaterThanOrEqual(2)
      for (const f of doModulo) {
        const src = ler(f)
        const tenant = src.search(/\brequireTenant\(/)
        const gate = src.search(new RegExp(`\\brequirePainelModule\\(\\s*ctx,\\s*'${modulo}'\\s*\\)`))
        expect(tenant, `${rel(f)} não chama requireTenant`).toBeGreaterThan(-1)
        expect(gate, `${rel(f)} não chama requirePainelModule(ctx, '${modulo}')`).toBeGreaterThan(-1)
        expect(gate, `${rel(f)} confere o módulo antes de requireTenant`).toBeGreaterThan(tenant)
        // Nada de ler dado antes do guarda do módulo.
        expect(src.slice(0, gate), `${rel(f)} lê dado antes do guarda do módulo`).not.toMatch(/\bawait request\.|formData\(|\.json\(\)|\bctx\.db/)
      }
    }
  })

  test('toda route.ts dos módulos (envio de imagem) chama requireTenant e uma função do domínio do módulo, que confere o módulo ligado', () => {
    const DOMINIOS: Record<string, string> = { fidelidade: 'loyalty', banners: 'banners', loja: 'store' }
    for (const [pasta, dominio] of Object.entries(DOMINIOS)) {
      const rotas = todos.filter((f) => rel(f).startsWith(`${pasta}/`) && rel(f).endsWith('/route.ts'))
      expect(rotas.length, `${pasta} sem rotas`).toBeGreaterThan(0)
      for (const f of rotas) {
        const src = ler(f)
        expect(src, `${rel(f)} não chama requireTenant`).toMatch(/\brequireTenant\(/)
        expect(src, `${rel(f)} não usa o domínio de ${dominio}`).toContain(`from '@/server/domain/${dominio}/`)
      }
    }
  })

  test('nenhuma página ou ação do painel importa o cliente cru do banco', () => {
    for (const f of todos.filter((x) => /\.(ts|tsx)$/.test(x))) {
      expect(ler(f), `${rel(f)} importa @/server/db/client`).not.toMatch(/from '@\/server\/db\/client'/)
    }
  })
})
