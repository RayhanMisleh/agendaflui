import { describe, expect, test } from 'vitest'
import { classifyConnectionError, selfCheckDatabase } from '@/server/db/self-check'
import type { CheckClient } from '@/server/db/self-check'

type Resposta = { rows: Record<string, unknown>[] } | Error

/** Banco simulado: cada consulta tem uma resposta (ou erro) por trecho do SQL; registra o que recebeu. */
function banco(respostas: Record<string, Resposta | Resposta[]>) {
  const log: string[] = []
  const contagem = new Map<string, number>()
  let liberados = 0
  const acquire = async (): Promise<CheckClient> => ({
    async query(sql: string) {
      log.push(sql)
      const chave = Object.keys(respostas).find((k) => sql.includes(k))
      if (!chave) return { rows: [] }
      const r = respostas[chave]!
      const n = contagem.get(chave) ?? 0
      contagem.set(chave, n + 1)
      const escolhida = Array.isArray(r) ? (r[Math.min(n, r.length - 1)] as Resposta) : r
      if (escolhida instanceof Error) throw escolhida
      return escolhida
    },
    release() {
      liberados++
    },
  })
  return { acquire, log, liberados: () => liberados }
}

const utc = { rows: [{ TimeZone: 'UTC' }] }
const extensaoOk = { rows: [{ instalada: true, disponivel: true, pode_criar: true }] }
const bom = { 'SHOW timezone': utc, pg_advisory_xact_lock: { rows: [] }, pg_extension: extensaoOk }

describe('selfCheckDatabase', () => {
  test('caso feliz: três checagens passam e toda conexão é devolvida', async () => {
    const b = banco(bom)
    await expect(selfCheckDatabase(b.acquire)).resolves.toBeUndefined()
    expect(b.log.filter((s) => s.includes('SHOW timezone'))).toHaveLength(2)
    expect(b.log.filter((s) => s === 'BEGIN')).toHaveLength(b.log.filter((s) => s === 'COMMIT').length)
    expect(b.liberados()).toBeGreaterThanOrEqual(4)
  })

  test('fuso que não é UTC na segunda conexão: mensagem exata sobre o pooler', async () => {
    const b = banco({ ...bom, 'SHOW timezone': [utc, { rows: [{ TimeZone: 'America/Sao_Paulo' }] }] })
    await expect(selfCheckDatabase(b.acquire)).rejects.toThrow(
      'O banco não manteve o fuso UTC da sessão (provável pooler em modo transação). Defina DATABASE_USE_DIRECT_URL=true para o servidor usar a conexão direta.',
    )
    expect(b.liberados()).toBeGreaterThanOrEqual(2)
  })

  test('fuso errado já na primeira conexão também é recusado', async () => {
    const b = banco({ ...bom, 'SHOW timezone': { rows: [{ TimeZone: 'Europe/Paris' }] } })
    await expect(selfCheckDatabase(b.acquire)).rejects.toThrow(/fuso UTC/)
  })

  test('trava de transação que falha: mensagem acionável', async () => {
    const b = banco({ ...bom, pg_advisory_xact_lock: new Error('prepared statement does not exist') })
    await expect(selfCheckDatabase(b.acquire)).rejects.toThrow(/pg_advisory_xact_lock.*DATABASE_USE_DIRECT_URL=true/s)
  })

  test('btree_gist ausente e indisponível: diz que a extensão precisa ser habilitada', async () => {
    const b = banco({ ...bom, pg_extension: { rows: [{ instalada: false, disponivel: false, pode_criar: true }] } })
    await expect(selfCheckDatabase(b.acquire)).rejects.toThrow(/extensão btree_gist precisa ser habilitada no banco/)
  })

  test('btree_gist ausente sem permissão para criar: mesma orientação', async () => {
    const b = banco({ ...bom, pg_extension: { rows: [{ instalada: false, disponivel: true, pode_criar: false }] } })
    await expect(selfCheckDatabase(b.acquire)).rejects.toThrow(/btree_gist/)
  })

  test('btree_gist ausente mas criável pela migração passa', async () => {
    const b = banco({ ...bom, pg_extension: extensaoOk && { rows: [{ instalada: false, disponivel: true, pode_criar: true }] } })
    await expect(selfCheckDatabase(b.acquire)).resolves.toBeUndefined()
  })

  test('falha ao conectar vira categoria curta, sem a mensagem do driver', async () => {
    const acquire = () => Promise.reject(Object.assign(new Error('password authentication failed for postgres://u:segredo@h/d'), { code: '28P01' }))
    const erro = await selfCheckDatabase(acquire).then(() => null, (e: unknown) => e)
    expect(String(erro)).toMatch(/autenticação/)
    expect(String(erro)).not.toContain('segredo')
  })
})

describe('classifyConnectionError', () => {
  test.each([
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' }, 'tls'],
    [{ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'x' }, 'tls'],
    [{ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'x' }, 'tls'],
    [{ message: 'The server does not support SSL connections' }, 'tls'],
    [{ code: '28P01', message: 'password authentication failed' }, 'auth'],
    [{ code: '28000', message: 'no pg_hba.conf entry' }, 'auth'],
    [{ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }, 'timeout'],
    [{ message: 'timeout expired' }, 'timeout'],
    [{ message: 'Connection terminated due to connection timeout' }, 'timeout'],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND h' }, 'dns'],
    [{ code: 'EAI_AGAIN', message: 'x' }, 'dns'],
    [{ code: 'ECONNREFUSED', message: 'x' }, 'other'],
    [new Error('qualquer coisa'), 'other'],
    ['texto', 'other'],
    [null, 'other'],
  ])('%j -> %s', (erro, categoria) => {
    expect(classifyConnectionError(erro)).toBe(categoria)
  })
})
