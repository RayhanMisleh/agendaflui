import pg from 'pg'
import { pgConfig } from './connection'

export type ConnectionErrorCategory = 'tls' | 'auth' | 'timeout' | 'dns' | 'other'

export const CATEGORY_LABEL: Record<ConnectionErrorCategory, string> = {
  tls: 'TLS/certificado',
  auth: 'autenticação',
  timeout: 'tempo esgotado',
  dns: 'host não encontrado',
  other: 'outro',
}

const CODIGOS_TLS = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i

/** Categoria curta de um erro de conexão. Só olha o código e o tipo da falha; a mensagem do driver pode trazer a URL e nunca é repetida. */
export function classifyConnectionError(erro: unknown): ConnectionErrorCategory {
  if (typeof erro !== 'object' || erro === null) return 'other'
  const codigo = 'code' in erro && typeof erro.code === 'string' ? erro.code : ''
  const mensagem = 'message' in erro && typeof erro.message === 'string' ? erro.message : ''
  if (CODIGOS_TLS.test(codigo) || /does not support SSL|certificate|\bSSL\b|\bTLS\b/i.test(mensagem)) return 'tls'
  if (codigo === '28P01' || codigo === '28000' || /authentication failed/i.test(mensagem)) return 'auth'
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') return 'dns'
  if (codigo === 'ETIMEDOUT' || /timeout|timed out/i.test(mensagem)) return 'timeout'
  return 'other'
}

export type CheckClient = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}

const MSG_FUSO =
  'O banco não manteve o fuso UTC da sessão (provável pooler em modo transação). Defina DATABASE_USE_DIRECT_URL=true para o servidor usar a conexão direta.'
const MSG_TRAVA =
  'O banco não aceitou travas de transação (pg_advisory_xact_lock), que a agenda usa (provável pooler em modo transação). Defina DATABASE_USE_DIRECT_URL=true para o servidor usar a conexão direta.'
const MSG_EXTENSAO =
  'A extensão btree_gist precisa ser habilitada no banco (CREATE EXTENSION btree_gist, com um usuário com permissão) antes de iniciar.'

/** Roda `sql` dentro de uma transação própria, numa conexão que volta ao pool no fim. */
async function emTransacao<T>(acquire: () => Promise<CheckClient>, sql: string): Promise<T> {
  let cliente: CheckClient
  try {
    cliente = await acquire()
  } catch (erro) {
    throw new Error(`Não foi possível conectar ao banco (${CATEGORY_LABEL[classifyConnectionError(erro)]}). Confira DATABASE_URL e, para erro de certificado, o sslmode da URL fornecida pela plataforma.`)
  }
  try {
    await cliente.query('BEGIN')
    const r = await cliente.query(sql)
    await cliente.query('COMMIT')
    return r.rows as T
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined)
    throw erro
  } finally {
    cliente.release()
  }
}

async function fusoDaSessao(acquire: () => Promise<CheckClient>): Promise<string> {
  const rows = await emTransacao<Record<string, unknown>[]>(acquire, 'SHOW timezone')
  const valor = Object.values(rows[0] ?? {})[0]
  return typeof valor === 'string' ? valor : ''
}

/**
 * Confere, antes de servir, que o banco se comporta como a aplicação precisa nas conexões do tipo que o servidor usa:
 * fuso UTC mantido entre transações, trava de transação e extensão btree_gist (existente ou criável pela migração).
 * Cada checagem roda em transação separada. As mensagens nunca trazem a URL nem a senha.
 */
export async function selfCheckDatabase(acquire: () => Promise<CheckClient>): Promise<void> {
  for (let i = 0; i < 2; i++) {
    if (!/^(etc\/)?utc$/i.test(await fusoDaSessao(acquire))) throw new Error(MSG_FUSO)
  }
  try {
    await emTransacao(acquire, 'SELECT pg_advisory_xact_lock(72707371)')
  } catch (erro) {
    if (erro instanceof Error && erro.message.startsWith('Não foi possível conectar')) throw erro
    throw new Error(MSG_TRAVA)
  }
  const [ext] = await emTransacao<{ instalada: boolean; disponivel: boolean; pode_criar: boolean }[]>(
    acquire,
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS instalada,
            EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') AS disponivel,
            (has_database_privilege(current_user, current_database(), 'CREATE')
              OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS pode_criar`,
  )
  if (!ext?.instalada && !(ext?.disponivel && ext.pode_criar)) throw new Error(MSG_EXTENSAO)
}

/** Autoverificação contra um banco de verdade, com a mesma conexão (URL e opções) que o servidor usa. */
export async function runSelfCheck(url: string): Promise<void> {
  const pool = new pg.Pool({ ...pgConfig(url), max: 1, connectionTimeoutMillis: 5000 })
  pool.on('error', () => undefined)
  try {
    await selfCheckDatabase(async () => {
      const c = await pool.connect()
      return { query: (sql) => c.query(sql), release: () => c.release() }
    })
  } finally {
    await pool.end().catch(() => undefined)
  }
}
