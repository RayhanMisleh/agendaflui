import 'server-only'
import { prisma } from './client'
import { PLATFORM_MODELS } from './models'

/** Acesso a dados de uma conta que tentou sair do escopo dela. */
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantViolationError'
  }
}

export type Args = Record<string, unknown>
type Campo = { name: string; kind: string; type: string }

/** Os `kind` que o Prisma 7 emite nos metadados (FieldKind). Qualquer outro falha fechado. */
const KINDS_CONHECIDOS: readonly string[] = ['scalar', 'enum', 'object', 'unsupported']

const OPERADORES_DE_RELACAO = ['some', 'every', 'none', 'is', 'isNot']

export function ehObjeto(valor: unknown): valor is Args {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function comoLista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return []
  return Array.isArray(valor) ? valor : [valor]
}

// Metadados de relação do cliente gerado (campo interno `_runtimeDataModel`, gerado do schema).
// Se o formato mudar, falha fechado em vez de deixar passar.
let camposPorModelo: Map<string, Campo[]> | undefined

/** Valida o formato dos metadados; qualquer dúvida falha fechado. */
export function lerMetadados(bruto: unknown): Map<string, Campo[]> {
  if (!ehObjeto(bruto) || !ehObjeto(bruto['models'])) {
    throw new TenantViolationError('Metadados de relação do Prisma indisponíveis.')
  }
  const modelos = bruto['models']
  const mapa = new Map<string, Campo[]>()
  for (const [nome, definicao] of Object.entries(modelos)) {
    const lista = ehObjeto(definicao) ? definicao['fields'] : undefined
    if (!Array.isArray(lista)) throw new TenantViolationError('Metadados de relação do Prisma inválidos.')
    for (const campo of lista) {
      if (!ehObjeto(campo) || typeof campo['name'] !== 'string' || typeof campo['kind'] !== 'string') {
        throw new TenantViolationError(`${nome}: campo sem name ou kind nos metadados do Prisma.`)
      }
      if (!KINDS_CONHECIDOS.includes(campo['kind'])) {
        throw new TenantViolationError(`${nome}.${campo['name']}: kind "${campo['kind']}" desconhecido nos metadados do Prisma.`)
      }
      if (campo['kind'] === 'object' && (typeof campo['type'] !== 'string' || !(campo['type'] in modelos))) {
        throw new TenantViolationError(`${nome}.${campo['name']}: relação sem modelo-alvo conhecido.`)
      }
    }
    mapa.set(nome, lista as Campo[])
  }
  return mapa
}

function campos(modelo: string): Campo[] {
  camposPorModelo ??= lerMetadados((prisma as unknown as { _runtimeDataModel?: unknown })._runtimeDataModel)
  const lista = camposPorModelo.get(modelo)
  if (!lista) throw new TenantViolationError(`${modelo}: modelo desconhecido.`)
  return lista
}

/** Modelo-alvo se `campo` for relação de `modelo`. */
export function alvoDaRelacao(modelo: string, campo: string): string | undefined {
  const f = campos(modelo).find((c) => c.name === campo)
  return f?.kind === 'object' ? f.type : undefined
}

function entrarEm(modelo: string, campo: string, alvo: string): void {
  if ((PLATFORM_MODELS as readonly string[]).includes(alvo)) {
    throw new TenantViolationError(`${modelo}.${campo}: relação com ${alvo} não é permitida no cliente por conta.`)
  }
}

function contagens(modelo: string, valor: unknown): void {
  if (valor === true) {
    for (const c of campos(modelo)) if (c.kind === 'object') entrarEm(modelo, c.name, c.type)
    return
  }
  const sel = ehObjeto(valor) ? valor['select'] : undefined
  if (!ehObjeto(sel)) return
  for (const [campo, v] of Object.entries(sel)) {
    const alvo = v ? alvoDaRelacao(modelo, campo) : undefined
    if (!alvo) continue
    entrarEm(modelo, campo, alvo)
    if (ehObjeto(v)) percorrerWhere(alvo, v['where'])
  }
}

/** `where` em qualquer forma: AND/OR/NOT, filtros de relação (some, every, none, is, isNot) e forma direta. */
function percorrerWhere(modelo: string, where: unknown): void {
  for (const item of comoLista(where)) {
    if (!ehObjeto(item)) continue
    for (const [chave, valor] of Object.entries(item)) {
      if (chave === 'AND' || chave === 'OR' || chave === 'NOT') {
        percorrerWhere(modelo, valor)
        continue
      }
      const alvo = alvoDaRelacao(modelo, chave)
      if (alvo) {
        entrarEm(modelo, chave, alvo)
        percorrerWhere(alvo, valor)
      } else if (OPERADORES_DE_RELACAO.includes(chave) && !campos(modelo).some((c) => c.name === chave)) {
        percorrerWhere(modelo, valor)
      }
    }
  }
}

/** `orderBy` em objeto ou lista: ordenação por campo de relação e por `_count` de relação. */
function percorrerOrdenacao(modelo: string, orderBy: unknown): void {
  for (const item of comoLista(orderBy)) {
    if (!ehObjeto(item)) continue
    for (const [chave, valor] of Object.entries(item)) {
      if (chave === '_count') {
        if (ehObjeto(valor)) {
          for (const campo of Object.keys(valor)) {
            const alvo = alvoDaRelacao(modelo, campo)
            if (alvo) entrarEm(modelo, campo, alvo)
          }
        }
        continue
      }
      const alvo = alvoDaRelacao(modelo, chave)
      if (!alvo) continue
      entrarEm(modelo, chave, alvo)
      percorrerOrdenacao(alvo, valor)
    }
  }
}

/** `distinct` e `by`: nomes de campo; nenhum pode ser relação de plataforma. */
function percorrerNomes(modelo: string, nomes: unknown): void {
  for (const nome of comoLista(nomes)) {
    const alvo = typeof nome === 'string' ? alvoDaRelacao(modelo, nome) : undefined
    if (alvo) entrarEm(modelo, String(nome), alvo)
  }
}

/**
 * Percorre os argumentos de uma operação (e, recursivamente, os de `include`/`select`) e recusa
 * qualquer caminho que entre em modelo de plataforma: `where`, `orderBy`, `cursor`, `distinct`,
 * `having`, `by`, `include`, `select` e `_count`.
 */
export function percorrerArgumentos(modelo: string, args: Args): void {
  percorrerWhere(modelo, args['where'])
  percorrerWhere(modelo, args['cursor'])
  percorrerWhere(modelo, args['having'])
  percorrerOrdenacao(modelo, args['orderBy'])
  percorrerNomes(modelo, args['distinct'])
  percorrerNomes(modelo, args['by'])
  for (const chave of ['include', 'select']) {
    const sel = args[chave]
    if (!ehObjeto(sel)) continue
    for (const [campo, valor] of Object.entries(sel)) {
      if (campo === '_count') {
        contagens(modelo, valor)
        continue
      }
      if (!valor) continue
      const alvo = alvoDaRelacao(modelo, campo)
      if (!alvo) continue
      entrarEm(modelo, campo, alvo)
      if (ehObjeto(valor)) percorrerArgumentos(alvo, valor)
    }
  }
}
