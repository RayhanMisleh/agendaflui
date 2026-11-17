import type { PoolConfig } from 'pg'

/** Configuração da conexão do servidor com o banco. A autoverificação da partida usa a mesma, para testar o que o servidor vai usar. */
export function pgConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    // A sessão é sempre UTC, qualquer que seja o padrão do servidor ou do banco.
    options: '-c timezone=UTC',
  }
}
