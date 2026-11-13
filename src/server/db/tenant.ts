import { prisma } from './client'
import { PLATFORM_MODELS, SELF_MODELS, TENANT_MODELS, TENANT_OPTIONAL_MODELS } from './models'

/** Acesso a dados de uma conta que tentou sair do escopo dela. */
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantViolationError'
  }
}

// O que `tenantDb` garante:
// - filtro por conta nas operações diretas: modelos tenant e tenant-opcionais filtram por
//   `businessId = conta` e gravam a conta no create; `Business` só existe como o próprio registro;
// - modelos de plataforma (usuários, sessões, admins) são bloqueados, inclusive por relação
//   em `include`/`select`/`_count`;
// - escrita aninhada (campo de relação em `data`) é recusada: use chaves escalares;
// - SQL cru é bloqueado e as operações dentro de `$transaction` continuam filtradas;
// - relações entre tabelas de conta ficam na mesma conta, porque o banco exige FK composta com
//   `business_id` (teste estrutural em schema.test.ts).
// O que NÃO garante: filtros de relação dentro de `where` não são percorridos, então um
// `where: { user: { memberships: { some: ... } } }` pode revelar a existência de vínculo em
// outra conta. O resultado continua só com linhas da própria conta.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Args = Record<string, unknown>
type Campo = { name: string; kind: string; type: string }

const OPERACOES_DE_LEITURA = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]
const OPERACOES_DE_ALTERACAO = ['update', 'updateMany', 'updateManyAndReturn']
const OPERACOES_DE_EXCLUSAO = ['delete', 'deleteMany']

function ehObjeto(valor: unknown): valor is Args {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function comoLista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return []
  return Array.isArray(valor) ? valor : [valor]
}

function em(lista: readonly string[], modelo: string): boolean {
  return lista.includes(modelo)
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
function alvoDaRelacao(modelo: string, campo: string): string | undefined {
  const f = campos(modelo).find((c) => c.name === campo)
  return f?.kind === 'object' ? f.type : undefined
}

function entrarEm(modelo: string, campo: string, alvo: string): void {
  if (em(PLATFORM_MODELS, alvo)) {
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
    if (alvo) entrarEm(modelo, campo, alvo)
  }
}

/** Percorre `include`/`select` em todos os níveis e recusa entrada em modelos de plataforma. */
function percorrerRelacoes(modelo: string, args: Args): void {
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
      if (ehObjeto(valor)) percorrerRelacoes(alvo, valor)
    }
  }
}

/** Combina o filtro do chamador com a restrição da conta, sem perder um nem sobrescrever o outro. */
function filtrar(where: unknown, campo: string, valor: string): Args {
  const base = ehObjeto(where) ? where : {}
  return { ...base, AND: [...comoLista(base['AND']), { [campo]: valor }] }
}

/** Dados de escrita: sem relação aninhada e sem trocar o campo que prende o registro à conta. */
function conferirDados(data: unknown, modelo: string, campo: string, valor: string): Args {
  if (!ehObjeto(data)) throw new TenantViolationError(`Dados inválidos para ${modelo}.`)
  for (const chave of Object.keys(data)) {
    if (alvoDaRelacao(modelo, chave)) {
      throw new TenantViolationError(`${modelo}.${chave}: escrita aninhada não é permitida; use a chave escalar.`)
    }
  }
  if (campo in data) {
    const enviado = ehObjeto(data[campo]) ? data[campo]['set'] : data[campo]
    if (enviado !== valor) {
      throw new TenantViolationError(`${modelo}: ${campo} diferente da conta do cliente.`)
    }
  }
  return data
}

function paraCriacao(data: unknown, modelo: string, businessId: string): Args {
  return { ...conferirDados(data, modelo, 'businessId', businessId), businessId }
}

function escoparPorConta(modelo: string, operacao: string, args: Args, businessId: string): Args {
  const filtro = (): Args => filtrar(args['where'], 'businessId', businessId)
  if (OPERACOES_DE_LEITURA.includes(operacao) || OPERACOES_DE_EXCLUSAO.includes(operacao)) {
    return { ...args, where: filtro() }
  }
  switch (operacao) {
    case 'create':
      return { ...args, data: paraCriacao(args['data'], modelo, businessId) }
    case 'createMany':
    case 'createManyAndReturn':
      return {
        ...args,
        data: ehObjeto(args['data'])
          ? paraCriacao(args['data'], modelo, businessId)
          : comoLista(args['data']).map((d) => paraCriacao(d, modelo, businessId)),
      }
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      return { ...args, where: filtro(), data: conferirDados(args['data'], modelo, 'businessId', businessId) }
    case 'upsert':
      return {
        ...args,
        where: filtro(),
        create: paraCriacao(args['create'], modelo, businessId),
        update: conferirDados(args['update'], modelo, 'businessId', businessId),
      }
    default:
      throw new TenantViolationError(`${modelo}.${operacao}: operação sem isolamento por conta.`)
  }
}

function escoparConta(operacao: string, args: Args, businessId: string): Args {
  const modelo = 'Business'
  if (OPERACOES_DE_LEITURA.includes(operacao)) {
    return { ...args, where: filtrar(args['where'], 'id', businessId) }
  }
  if (OPERACOES_DE_ALTERACAO.includes(operacao)) {
    return {
      ...args,
      where: filtrar(args['where'], 'id', businessId),
      data: conferirDados(args['data'], modelo, 'id', businessId),
    }
  }
  throw new TenantViolationError(`${modelo}.${operacao}: não é permitido pelo cliente por conta.`)
}

/** Aplica o isolamento aos argumentos de uma operação de modelo. Falha fechado. */
export function escoparOperacao(modelo: string, operacao: string, argumentos: unknown, businessId: string): Args {
  if (em(PLATFORM_MODELS, modelo)) {
    throw new TenantViolationError(`${modelo}.${operacao}: modelo de plataforma não é acessível pelo cliente por conta.`)
  }
  const args: Args = ehObjeto(argumentos) ? { ...argumentos } : {}
  if (em(SELF_MODELS, modelo)) {
    const escopado = escoparConta(operacao, args, businessId)
    percorrerRelacoes(modelo, escopado)
    return escopado
  }
  if (em(TENANT_MODELS, modelo) || em(TENANT_OPTIONAL_MODELS, modelo)) {
    const escopado = escoparPorConta(modelo, operacao, args, businessId)
    percorrerRelacoes(modelo, escopado)
    return escopado
  }
  throw new TenantViolationError(`${modelo} não está classificado: acesso recusado.`)
}

function bloquearSqlCru(operacao: string): never {
  throw new TenantViolationError(`${operacao} não é permitido no cliente por conta: use os métodos do modelo.`)
}

function criarExtensao(businessId: string) {
  return prisma.$extends({
    name: 'tenant',
    query: {
      $queryRaw: () => bloquearSqlCru('$queryRaw'),
      $executeRaw: () => bloquearSqlCru('$executeRaw'),
      $queryRawUnsafe: () => bloquearSqlCru('$queryRawUnsafe'),
      $executeRawUnsafe: () => bloquearSqlCru('$executeRawUnsafe'),
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(escoparOperacao(model, operation, args, businessId))
        },
      },
    },
  })
}

export type TenantClient = ReturnType<typeof criarExtensao>

/** Única porta do código de negócio para dados de uma conta. */
export function tenantDb(businessId: string): TenantClient {
  if (typeof businessId !== 'string' || !UUID.test(businessId)) {
    throw new TenantViolationError('businessId inválido: informe o UUID da conta.')
  }
  return criarExtensao(businessId)
}
