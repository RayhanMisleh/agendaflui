import { requireTenant } from '@/server/auth/guards'
import { receberLogo } from '../../_lib/logo-upload'

/** Logo pela seção Aparência: volta a ela com `?logo=ok` ou `?logo=<código>`. */
export async function POST(request: Request): Promise<Response> {
  const ctx = await requireTenant()
  return receberLogo(ctx, request, (codigo) => `/painel/configuracoes?secao=aparencia&logo=${codigo}`)
}
