/**
 * Nomes que nenhuma loja pode usar como slug: são rotas do sistema no endereço único do app.
 * A lista também vive no CHECK `businesses_slug_not_reserved` (migração); um teste confere que as duas são iguais.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'entrar',
  'sair',
  'conta',
  'convite',
  'cadastro',
  'esqueci-a-senha',
  'redefinir-senha',
  'definir-senha',
  'google',
  'painel',
  'webhooks',
  'arquivos',
  'brand',
  'healthz',
  'api',
  'dev',
  'admin',
  'www',
  'suporte',
  'app',
  'ajuda',
  'termos',
  'privacidade',
]

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug)
}
