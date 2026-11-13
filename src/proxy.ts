import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { routeRequest } from '@/server/hosts'
import type { HostConfig } from '@/server/hosts'

// Lê só as três variáveis de host: `env` validaria também DATABASE_URL e APP_SECRET,
// que o proxy não usa. Os padrões são os mesmos de src/server/env.ts.
function hostConfig(): HostConfig {
  return {
    dev: process.env.DEV_HOST || 'dev.localhost:3000',
    painel: process.env.PAINEL_HOST || 'painel.localhost:3000',
    api: process.env.API_HOST || 'api.localhost:3000',
  }
}

// Usa o cabeçalho Host. Não confia em X-Forwarded-Host: o proxy reverso deve preservar o Host.
export function proxy(request: NextRequest) {
  const decisao = routeRequest(
    request.headers.get('host'),
    request.nextUrl.pathname,
    hostConfig(),
  )
  if (decisao.action === 'pass') return NextResponse.next()
  const url = request.nextUrl.clone()
  // Rota inexistente: o Next responde 404 com a página not-found.
  url.pathname = decisao.action === 'rewrite' ? decisao.to : '/_nao-encontrado'
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
