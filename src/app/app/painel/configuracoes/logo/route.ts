import { receberLogo } from '../../_lib/logo-upload'

/** Logo pela seção Aparência: volta a ela com `?logo=ok` ou `?logo=<código>`. */
export async function POST(request: Request): Promise<Response> {
  return receberLogo(request, (codigo) => `/painel/configuracoes?secao=aparencia&logo=${codigo}`)
}
