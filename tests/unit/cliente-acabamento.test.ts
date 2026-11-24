import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { arquivosCom } from '../setup/varredura'

const RAIZ = join(__dirname, '../..')
const LOJA = 'src/app/app/[slug]'
const CSS_DO_CLIENTE = ['src/ui/styles/cliente.css', 'src/ui/styles/cliente-pet.css']

function arquivos(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivos(caminho, ext) : ext.test(nome) ? [caminho] : []
  })
}

/** Tira comentários de linha e de bloco: um comentário não pode satisfazer nem quebrar a varredura. */
const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

test('nenhum termo de outro ramo nem rastro da API do app na área do cliente e nos componentes', () => {
  const achados = arquivosCom(/\b(tutor|tosador|tosadora|patinhas)\b|API do app/i, [LOJA, 'src/ui'])
  expect(achados).toEqual([])
})

test('a varredura de texto enxerga um termo proibido', () => {
  expect(/\b(tutor|tosador|tosadora|patinhas)\b|API do app/i.test('Olá, tutor!')).toBe(true)
  expect(/\b(tutor|tosador|tosadora|patinhas)\b|API do app/i.test('tutorial do cliente')).toBe(false)
})

test('nenhum arquivo da área do cliente importa o cliente cru do Prisma', () => {
  const achados = arquivos(join(RAIZ, LOJA), /\.(ts|tsx)$/)
    .filter((f) => /from '@\/server\/db\/client'/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(RAIZ, f))
  expect(achados).toEqual([])
})

/** Ações e consultas que não passam pelo guarda do cliente, com o motivo (entrar ainda não é ser cliente). */
const SEM_GUARDA_DE_CLIENTE: Record<string, string> = {
  'actions.ts': 'usar a minha conta: a pessoa entrou, mas ainda não é cliente; resolve a visita e a confere',
  '(acesso)/cadastro/actions.ts': 'cadastro pela loja: ainda não há cliente; resolve a visita depois de criar a conta',
  '(acesso)/entrar/actions.ts': 'entrada pela loja: ainda não há cliente; resolve a visita depois de entrar',
}

test('toda ação e consulta da área do cliente confere o vínculo de cliente com ESTA loja', () => {
  const alvo = arquivos(join(RAIZ, LOJA), /(^|[\\/])(actions|consultas)\.ts$/)
  expect(alvo.length).toBeGreaterThanOrEqual(8)
  for (const f of alvo) {
    const rel = relative(join(RAIZ, LOJA), f).split('\\').join('/')
    if (rel in SEM_GUARDA_DE_CLIENTE) continue
    const src = semComentarios(readFileSync(f, 'utf8'))
    expect(/clienteAction\(|requireCustomer\(|consultar\(/.test(src), `${rel} não passa por clienteAction, requireCustomer nem consultar`).toBe(true)
  }
})

test('as ações de fora da regra existem e resolvem a visita da loja', () => {
  for (const rel of Object.keys(SEM_GUARDA_DE_CLIENTE)) {
    expect(semComentarios(readFileSync(join(RAIZ, LOJA, rel), 'utf8')), rel).toContain('resolveStoreVisit(')
  }
})

test('toda rota de arquivo da área do cliente confere a visita', () => {
  const rotas = arquivos(join(RAIZ, LOJA), /route\.ts$/)
  expect(rotas.length).toBeGreaterThanOrEqual(2)
  for (const f of rotas) expect(semComentarios(readFileSync(f, 'utf8')), relative(RAIZ, f)).toMatch(/readStoreVisit\(|requireCustomer\(/)
})

describe.each(CSS_DO_CLIENTE)('%s', (css) => {
  const src = readFileSync(join(RAIZ, css), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  test('sem caixa alta em rótulo (só a primeira letra de uma data pode subir)', () => {
    const regras = [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , corpo]) => /text-transform:\s*uppercase/.test(corpo ?? ''))
    for (const [, seletor] of regras) expect(seletor, 'só ::first-letter pode usar uppercase').toMatch(/::first-letter/)
  })

  test('toda animação e transição de movimento fica sob prefers-reduced-motion: no-preference', () => {
    // Percorre os blocos guardando se estão dentro do @media de movimento.
    let nivel = 0
    const pilha: boolean[] = []
    let cabeca = ''
    const achados: string[] = []
    for (const ch of src) {
      if (ch === '{') {
        pilha.push(/prefers-reduced-motion:\s*no-preference/.test(cabeca) || /^\s*@keyframes/.test(cabeca) || (pilha.at(-1) ?? false))
        nivel++
        cabeca = ''
      } else if (ch === '}') {
        pilha.pop()
        nivel--
        cabeca = ''
      } else if (ch === ';') {
        const m = /^\s*(animation|transition)\s*:\s*(.+)$/s.exec(cabeca)
        if (m && !(pilha.at(-1) ?? false) && !/^none$/.test((m[2] ?? '').trim())) achados.push(cabeca.trim())
        cabeca = ''
      } else cabeca += ch
    }
    expect(nivel).toBe(0)
    expect(achados).toEqual([])
  })
})

test('o CSS do cliente está importado e vem antes do movimento', () => {
  const imports = [...readFileSync(join(RAIZ, 'src/ui/ui.css'), 'utf8').matchAll(/@import '([^']+)'/g)].map((m) => m[1])
  expect(imports).toContain('./styles/cliente-pet.css')
  expect(imports.indexOf('./styles/cliente-pet.css')).toBeLessThan(imports.indexOf('./styles/motion.css'))
})
