import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { redirect } from 'next/navigation'
import { iconesDaConta } from '@/app/app/_lib/marca'
import { can } from '@/server/auth/capabilities'
import { readPersonSession, requireTenant } from '@/server/auth/guards'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { LinkButton } from '@/ui/components'
import { PainelShell, painelNav } from '@/ui/shells'
import { EncerrarSuporte } from './_lib/EncerrarSuporte'
import { SairDaConta } from './_lib/SairDaConta'

/** O favicon da conta ativa na aba do navegador, quando a conta enviou um. */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await requireTenant()
  const icons = iconesDaConta((await getPublicBrandById(ctx.businessId))?.faviconUrl ?? null)
  return icons ? { icons } : {}
}

/**
 * Rotas do painel que já têm tela. As outras aparecem na barra esmaecidas (com cadeado) até a tela existir: cada tarefa de
 * tela acrescenta a sua rota aqui.
 */
const ROTAS_PRONTAS: ReadonlySet<string> = new Set(['/painel', '/painel/agenda', '/painel/servicos', '/painel/clientes', '/painel/equipe', '/painel/relatorios', '/painel/configuracoes', '/painel/fidelidade', '/painel/banners', '/painel/loja', '/conta'])

/**
 * A moldura do painel do negócio (barra lateral, topo, menu e faixa de suporte) no tema da conta. Ela mora aqui, no layout,
 * e por isso não remonta nem pisca ao navegar: cada página desenha só o miolo (`ShellPage`) e cada `loading.tsx` só o
 * esqueleto dele. O layout não roda de novo a cada navegação: cada página e action também chama `requireTenant`, e
 * quem muda algo da moldura (módulos, marca, nicho) chama `atualizarPainel`, que a lê de novo.
 */
export default async function PainelAppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenant()
  const [session, marca, painel] = await Promise.all([readPersonSession(), getPublicBrandById(ctx.businessId), getPainelContext(ctx)])
  if (!marca) redirect('/entrar')

  const nav = painelNav({ can: (c) => can(ctx.actor, c), modules: painel.modules }).map((item) => ({
    ...item,
    disabled: !ROTAS_PRONTAS.has(item.href),
  }))
  const suporte = ctx.actor.kind === 'impersonator'
  const nome = painel.userName || (session?.kind === 'person' ? session.user.name : '')

  return (
    <PainelShell
      theme={marca.theme}
      brand={{ name: marca.name, logoUrl: marca.logoUrl, symbolUrl: marca.symbolUrl }}
      nav={nav}
      user={{ name: nome, roleLabel: painel.roleLabel, avatarUrl: null }}
      {...(suporte ? { supportBanner: `Você está em modo suporte na conta ${marca.name}`, supportAction: <EncerrarSuporte /> } : {})}
      accountActions={
        suporte ? null : (
          <>
            <LinkButton href="/conta" variant="ghost" icon={<UserRound size={18} />}>
              Minha conta
            </LinkButton>
            <SairDaConta />
          </>
        )
      }
    >
      {children}
    </PainelShell>
  )
}
