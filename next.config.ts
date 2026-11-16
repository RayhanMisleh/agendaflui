import type { NextConfig } from 'next'

// Cabeçalhos de todas as rotas. A rota /arquivos define a própria Content-Security-Policy
// (`default-src 'none'; sandbox`), por isso a regra de `frame-ancestors` não a cobre.
const CABECALHOS_GERAIS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  // O selo de desenvolvimento do Next aparece nas capturas da vitrine e não é parte do produto.
  devIndicators: false,
  poweredByHeader: false,
  // A criação de conta envia a logo (até 8 MiB, o limite do armazenamento de imagens) junto do formulário.
  // O padrão do Next é 1 MB; 8,1 MiB deixa folga só para os campos do formulário.
  experimental: { serverActions: { bodySizeLimit: '8.1mb' } },
  async headers() {
    return [
      { source: '/:path*', headers: CABECALHOS_GERAIS },
      {
        source: '/((?!arquivos(?:/|$)).*)',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }],
      },
    ]
  },
}

export default nextConfig
