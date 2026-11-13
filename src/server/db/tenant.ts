import { prisma } from './client'
import { TENANT_MODELS, GLOBAL_MODELS } from './models'

/** Acesso a dados de uma conta que tentou sair do escopo dela. */
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantViolationError'
  }
}

// Limite conhecido: escritas aninhadas (`data: { rel: { create } }`) e `include`/`select` de
// relações atravessam para outros modelos sem passar por esta extensão. Hoje os modelos tenant
// só se relacionam entre si por `Business`, então nada vaza. Quando surgirem relações entre
// modelos tenant, cada uma precisa de filtro próprio (ou de chave estrangeira composta).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Args = Record<string, unknown>

const LEITURAS_COM_FILTRO = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'deleteMany',
]
const LEITURAS_UNICAS = ['findUnique', 'findUniqueOrThrow', 'delete']

function ehObjeto(valor: unknown): valor is Args {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function comoLista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return []
  return Array.isArray(valor) ? valor : [valor]
}

/** Combina o filtro do chamador com a conta, sem perder um nem sobrescrever o outro. */
function filtrar(where: unknown, businessId: string): Args {
  const base = ehObjeto(where) ? where : {}
  return { ...base, AND: [...comoLista(base['AND']), { businessId }] }
}

/** Dados de escrita: recusa mudar a conta do registro. */
function conferirDados(data: unknown, businessId: string, modelo: string): Args {
  if (!ehObjeto(data)) throw new TenantViolationError(`Dados inválidos para ${modelo}.`)
  if ('business' in data) {
    throw new TenantViolationError(`${modelo}: não é permitido ligar o registro a outra conta.`)
  }
  if ('businessId' in data) {
    const valor = data['businessId']
    const enviado = ehObjeto(valor) ? valor['set'] : valor
    if (enviado !== businessId) {
      throw new TenantViolationError(`${modelo}: businessId diferente da conta do cliente.`)
    }
  }
  return data
}

function paraCriacao(data: unknown, businessId: string, modelo: string): Args {
  return { ...conferirDados(data, businessId, modelo), businessId }
}

/** Aplica a conta aos argumentos de uma operação de modelo tenant. Falha fechado. */
export function escoparOperacao(
  modelo: string,
  operacao: string,
  argumentos: unknown,
  businessId: string,
): Args {
  const args: Args = ehObjeto(argumentos) ? { ...argumentos } : {}

  if (LEITURAS_COM_FILTRO.includes(operacao) || LEITURAS_UNICAS.includes(operacao)) {
    return { ...args, where: filtrar(args['where'], businessId) }
  }
  switch (operacao) {
    case 'create':
      return { ...args, data: paraCriacao(args['data'], businessId, modelo) }
    case 'createMany':
    case 'createManyAndReturn':
      return {
        ...args,
        data: ehObjeto(args['data'])
          ? paraCriacao(args['data'], businessId, modelo)
          : comoLista(args['data']).map((d) => paraCriacao(d, businessId, modelo)),
      }
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      return {
        ...args,
        where: filtrar(args['where'], businessId),
        data: conferirDados(args['data'], businessId, modelo),
      }
    case 'upsert':
      return {
        ...args,
        where: filtrar(args['where'], businessId),
        create: paraCriacao(args['create'], businessId, modelo),
        update: conferirDados(args['update'], businessId, modelo),
      }
    default:
      throw new TenantViolationError(`${modelo}.${operacao}: operação sem isolamento por conta.`)
  }
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
          if (GLOBAL_MODELS.includes(model)) return query(args)
          if (!TENANT_MODELS.includes(model)) {
            throw new TenantViolationError(`${model} não está classificado como tenant nem global.`)
          }
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
