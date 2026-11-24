import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { areaUrl, hostConfigFromEnv, routeRequest } from '@/server/hosts'

// Lê só as variáveis de host de host (`env` validaria também DATABASE_URL e APP_SECRET, que o proxy não usa).
// Usa o cabeçalho Host. Não confia em X-Forwarded-Host: o proxy reverso deve preservar o Host.
export function proxy(request: NextRequest) {
  const cfg = hostConfigFromEnv(process.env)
  const decisao = routeRequest(request.headers.get('host'), request.nextUrl.pathname, cfg)
  if (decisao.action === 'pass') return NextResponse.next()
  // Endereço antigo do painel: manda para o mesmo lugar no host único (308 mantém o método).
  if (decisao.action === 'redirect') {
    const protocolo = process.env.NODE_ENV === 'production' ? 'https' : 'http'
    return NextResponse.redirect(areaUrl('app', decisao.path + request.nextUrl.search, cfg, protocolo), 308)
  }
  const url = request.nextUrl.clone()
  // Rota inexistente: o Next responde 404 com a página not-found.
  url.pathname = decisao.action === 'rewrite' ? decisao.to : '/_nao-encontrado'
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
