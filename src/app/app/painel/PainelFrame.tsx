import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { readPersonSession } from '@/server/auth/guards'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { PainelShell, painelNav } from '@/ui/shells'
import { EncerrarSuporte } from './_lib/EncerrarSuporte'
import { SairDaConta } from './_lib/SairDaConta'

/**
 * Rotas do painel que já têm tela. As outras aparecem na barra esmaecidas (com cadeado) até a tela existir: cada tarefa de
 * tela acrescenta a sua rota aqui.
 */
const ROTAS_PRONTAS: ReadonlySet<string> = new Set(['/painel', '/painel/agenda', '/painel/servicos', '/painel/clientes', '/painel/equipe', '/painel/relatorios', '/painel/configuracoes', '/painel/fidelidade', '/painel/banners', '/painel/loja'])

/** Moldura do painel do negócio com a marca, a navegação por capacidade e o usuário da conta ativa. */
export async function PainelFrame({
  ctx,
  title,
  actions,
  children,
}: {
  ctx: TenantContext
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
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
      title={title}
      actions={actions}
      {...(suporte ? { supportBanner: `Você está em modo suporte na conta ${marca.name}`, supportAction: <EncerrarSuporte /> } : {})}
      accountActions={suporte ? null : <SairDaConta />}
    >
      {children}
    </PainelShell>
  )
}
