// Trava da fumaça: ela cria e apaga uma sessão de admin direto no banco, então só roda em banco local.

const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** O banco da URL é desta máquina? Só `localhost`, `127.0.0.1` e `::1` valem; nome parecido, IP de rede e texto solto não. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    return LOCAIS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Motivo para a fumaça NÃO rodar, ou `null` se pode. A mensagem nunca mostra o endereço do banco. */
export function smokeRefusal(env: { NODE_ENV?: string | undefined; DATABASE_URL?: string | undefined }): string | null {
  if (env.NODE_ENV === 'production') {
    return 'A fumaça não roda em produção (NODE_ENV=production): ela grava uma sessão de admin no banco. Rode no seu computador, com o banco de desenvolvimento.'
  }
  if (env.DATABASE_URL && !isLocalDatabaseUrl(env.DATABASE_URL)) {
    return 'A fumaça só roda em banco local (localhost, 127.0.0.1 ou ::1), e o DATABASE_URL aponta para outro lugar. Use o banco de desenvolvimento do projeto.'
  }
  return null
}
