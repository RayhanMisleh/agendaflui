import { getStorage } from '@/server/storage/storage'

const CABECALHOS_404 = { 'X-Content-Type-Options': 'nosniff' }

function naoEncontrado(): Response {
  return new Response('Arquivo não encontrado.', { status: 404, headers: CABECALHOS_404 })
}

async function servir(ctx: { params: Promise<{ key: string[] }> }, comCorpo: boolean): Promise<Response> {
  const { key } = await ctx.params
  const chave = key.map((parte) => {
    try {
      return decodeURIComponent(parte)
    } catch {
      return '\0'
    }
  }).join('/')
  let arquivo
  try {
    arquivo = await getStorage().get(chave)
  } catch {
    return naoEncontrado()
  }
  if (!arquivo) return naoEncontrado()
  return new Response(comCorpo ? new Uint8Array(arquivo.data) : null, {
    status: 200,
    headers: {
      'Content-Type': arquivo.contentType,
      'Content-Length': String(arquivo.data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return servir(ctx, true)
}

export function HEAD(_req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return servir(ctx, false)
}
