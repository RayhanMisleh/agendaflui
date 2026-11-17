import type { PoolConfig } from 'pg'

/**
 * URL de conexão para o `pg`. O driver trata `sslmode=require` como `verify-full`; com `uselibpqcompat=true` vale a
 * semântica padrão do libpq: `require` cifra sem validar a cadeia, e `verify-ca`/`verify-full` validam.
 * Só acrescenta o parâmetro quando há `sslmode` e não há `uselibpqcompat`; o resto da URL (senha inclusive) fica igual.
 * Todas as conexões do `pg` passam por aqui (um teste confere). Nunca registra a URL.
 */
export function pgConnectionString(url: string): string {
  if (!/[?&]sslmode=/i.test(url) || /[?&]uselibpqcompat=/i.test(url)) return url
  const [semAncora = '', ...ancora] = url.split('#')
  const sufixo = ancora.length > 0 ? `#${ancora.join('#')}` : ''
  return `${semAncora}${semAncora.includes('?') ? '&' : '?'}uselibpqcompat=true${sufixo}`
}

/** Configuração da conexão do servidor com o banco. A autoverificação da partida usa a mesma, para testar o que o servidor vai usar. */
export function pgConfig(connectionString: string): PoolConfig {
  return {
    connectionString: pgConnectionString(connectionString),
    // A sessão é sempre UTC, qualquer que seja o padrão do servidor ou do banco.
    options: '-c timezone=UTC',
  }
}
