import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { prisma } from './client'
import { Prisma } from './generated/client'
import { PLATFORM_MODELS, SELF_MODELS, TENANT_MODELS, TENANT_OPTIONAL_MODELS } from './models'
import { alvoDaRelacao, ehObjeto, lerMetadados, percorrerArgumentos, TenantViolationError } from './tenant-walk'

export { lerMetadados, TenantViolationError }

// O que `tenantDb` garante:
// - filtro por conta nas operações diretas: modelos tenant e tenant-opcionais filtram por
//   `businessId = conta` e gravam a conta no create; `Business` só existe como o próprio registro;
// - modelos de plataforma (usuários, sessões, admins) são bloqueados, inclusive por relação em
//   `include`/`select`/`_count` e em filtros e ordenação (`where`, `orderBy`, `cursor`, `distinct`,
//   `having`, `by`, em qualquer nível; o percurso fica em tenant-walk.ts);
// - escrita aninhada (campo de relação em `data`) é recusada: use chaves escalares;
// - SQL cru é bloqueado e as operações dentro de `$transaction` continuam filtradas; a única exceção
//   é `$lockKey`, a trava de transação por (conta, escopo, id), que só roda dentro de uma transação;
// - relações entre tabelas de conta ficam na mesma conta, porque o banco exige FK composta com
//   `business_id` (teste estrutural em schema.test.ts).
// Limite: filtros de relação entre modelos de conta são permitidos (o banco garante a mesma conta
// por FK composta); só os que entram em modelo de plataforma são recusados.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Args = Record<string, unknown>

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

function comoLista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return []
  return Array.isArray(valor) ? valor : [valor]
}

function em(lista: readonly string[], modelo: string): boolean {
  return lista.includes(modelo)
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

/** Campos que o código da conta pode alterar na própria conta; o resto é da plataforma. */
const CAMPOS_DA_CONTA_EDITAVEIS: readonly string[] = [
  'name',
  'segment',
  'document',
  'email',
  'phone',
  'addressLine',
  'city',
  'state',
  'postalCode',
]

function conferirCamposDaConta(data: Args): Args {
  for (const chave of Object.keys(data)) {
    if (!CAMPOS_DA_CONTA_EDITAVEIS.includes(chave)) {
      throw new TenantViolationError(`Business.${chave}: campo não pode ser alterado pelo cliente por conta.`)
    }
  }
  return data
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
      data: conferirCamposDaConta(conferirDados(args['data'], modelo, 'id', businessId)),
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
    percorrerArgumentos(modelo, escopado)
    return escopado
  }
  if (em(TENANT_MODELS, modelo) || em(TENANT_OPTIONAL_MODELS, modelo)) {
    const escopado = escoparPorConta(modelo, operacao, args, businessId)
    percorrerArgumentos(modelo, escopado)
    return escopado
  }
  throw new TenantViolationError(`${modelo} não está classificado: acesso recusado.`)
}

function bloquearSqlCru(operacao: string): never {
  throw new TenantViolationError(`${operacao} não é permitido no cliente por conta: use os métodos do modelo.`)
}

/** Escopos aceitos por `$lockKey`: lista fechada. */
const ESCOPOS_DE_TRAVA = ['professional', 'customer', 'membership'] as const
export type LockScope = (typeof ESCOPOS_DE_TRAVA)[number]

/**
 * Marca a execução do `$executeRaw` interno de `$lockKey`. Só este módulo grava o valor, então
 * nenhum SQL cru do chamador passa pela extensão.
 */
const travaPermitida = new AsyncLocalStorage<true>()

function criarExtensao(businessId: string) {
  return prisma.$extends({
    name: 'tenant',
    client: {
      /**
       * `pg_advisory_xact_lock` sobre `${conta}:${escopo}:${id}`, na transação em curso: espera a transação
       * que a detém terminar e a solta no commit ou rollback. Fora de transação é erro, porque a trava
       * seria solta na hora e daria falsa segurança.
       */
      async $lockKey(scope: LockScope, id: string): Promise<void> {
        if (this === undefined || this === null) {
          throw new TenantViolationError('$lockKey precisa ser chamado pelo cliente da transação, sem extrair o método.')
        }
        const cliente = Prisma.getExtensionContext(this)
        if (!ESCOPOS_DE_TRAVA.includes(scope)) {
          throw new TenantViolationError(`$lockKey: escopo "${String(scope)}" não é permitido.`)
        }
        if (typeof id !== 'string' || !UUID.test(id)) {
          throw new TenantViolationError('$lockKey: informe o UUID do registro a travar.')
        }
        // O cliente de transação interativa do Prisma não tem `$connect`, `$disconnect` nem `$extends`.
        const raiz = ['$connect', '$disconnect', '$extends'].some((metodo) => typeof Reflect.get(cliente, metodo) === 'function')
        if (raiz) {
          throw new TenantViolationError('$lockKey só pode ser usado dentro de uma transação ($transaction).')
        }
        const chave = `${businessId}:${scope}:${id.toLowerCase()}`
        // O PrismaPromise é preguiçoso: precisa ser aguardado dentro de `run` para a marca valer.
        await travaPermitida.run(true, async () => {
          await cliente.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${chave}, 0))`
        })
      },
    },
    query: {
      $queryRaw: () => bloquearSqlCru('$queryRaw'),
      $executeRaw: ({ args, query }) => (travaPermitida.getStore() ? query(args) : bloquearSqlCru('$executeRaw')),
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

/**
 * A mesma trava de `$lockKey`, para o domínio de plataforma, que trabalha com o `prisma` cru dentro de uma transação
 * (precisa tocar sessões e usuários, que `tenantDb` recusa). A chave é a mesma, então serializa com `$lockKey`.
 */
export async function lockKeyRaw(tx: Prisma.TransactionClient, businessId: string, scope: LockScope, id: string): Promise<void> {
  if (typeof businessId !== 'string' || !UUID.test(businessId)) throw new TenantViolationError('businessId inválido: informe o UUID da conta.')
  if (!ESCOPOS_DE_TRAVA.includes(scope)) throw new TenantViolationError(`lockKeyRaw: escopo "${String(scope)}" não é permitido.`)
  if (typeof id !== 'string' || !UUID.test(id)) throw new TenantViolationError('lockKeyRaw: informe o UUID do registro a travar.')
  if (['$connect', '$disconnect', '$extends'].some((metodo) => typeof Reflect.get(tx, metodo) === 'function')) {
    throw new TenantViolationError('lockKeyRaw só pode ser usado dentro de uma transação ($transaction).')
  }
  const chave = `${businessId}:${scope}:${id.toLowerCase()}`
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${chave}, 0))`
}

export type TenantClient = ReturnType<typeof criarExtensao>

/** Cliente recebido no callback de `ctx.db.$transaction(async (tx) => …)`. */
export type TenantTx = Parameters<Parameters<TenantClient['$transaction']>[0]>[0]

/** Única porta do código de negócio para dados de uma conta. */
export function tenantDb(businessId: string): TenantClient {
  if (typeof businessId !== 'string' || !UUID.test(businessId)) {
    throw new TenantViolationError('businessId inválido: informe o UUID da conta.')
  }
  return criarExtensao(businessId)
}
