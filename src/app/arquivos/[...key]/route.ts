import { getStorage } from '@/server/storage/storage'

// Só imagens raster saem daqui: qualquer outro tipo gravado (HTML, SVG...) seria conteúdo ativo na origem do painel.
const TIPOS_SERVIDOS = new Set(['image/webp', 'image/png', 'image/jpeg'])

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
  if (!arquivo || !TIPOS_SERVIDOS.has(arquivo.contentType)) return naoEncontrado()
  return new Response(comCorpo ? new Uint8Array(arquivo.data) : null, {
    status: 200,
    headers: {
      'Content-Type': arquivo.contentType,
      'Content-Length': String(arquivo.data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

export function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return servir(ctx, true)
}

export function HEAD(_req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return servir(ctx, false)
}
