import { receberLogo } from '../../_lib/logo-upload'

/** Logo pelo passo "Marca" do começo: volta a ele com `?logo=ok` ou `?logo=<código>`. */
export async function POST(request: Request): Promise<Response> {
  return receberLogo(request, (codigo) => `/painel/comecar?passo=marca&logo=${codigo}`)
}
