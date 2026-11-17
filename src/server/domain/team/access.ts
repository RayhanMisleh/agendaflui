import type { TenantContext } from '@/server/auth/actor'
import type { MembershipRole } from '@/server/db/generated/client'
import {
  alterarVinculo,
  convidar,
  enviarRedefinicao,
  listarEquipe,
  papelSchema,
  reenviarConvite,
  type Autor,
  type TeamMember,
} from '@/server/domain/platform/access-core'
import { authorize, DomainError, parse } from '@/server/domain/errors'

export type { TeamMember } from '@/server/domain/platform/access-core'

/*
 * Porta do dono e do gerente (e do suporte, "entrando como") para os acessos da equipe da conta. Fina: confere a capacidade
 * `manage_team` e entrega ao núcleo compartilhado com o painel dev (`platform/access-core.ts`), que relê o autor na
 * transação e aplica as regras: gerente não mexe em dono, ninguém altera o próprio vínculo, o último dono ativo não sai.
 * Auditoria com o ator do contexto (o suporte entra com a marca de suporte). O suporte faz tudo isto, menos mandar
 * redefinição de senha.
 */

const comoConta = (ctx: TenantContext): Autor => ({ kind: 'conta', ctx })

/** Todos os acessos da conta (ativos ou não), do mais antigo ao mais novo. */
export async function listAccess(ctx: TenantContext): Promise<TeamMember[]> {
  authorize(ctx, 'manage_team')
  return listarEquipe(ctx.businessId)
}

/** Convida alguém para a equipe; com `professionalId`, liga o acesso à ficha de profissional. Só dono convida dono. */
export async function inviteAccess(
  ctx: TenantContext,
  i: { name: string; email: string; role: MembershipRole; professionalId?: string | null },
): Promise<TeamMember> {
  authorize(ctx, 'manage_team')
  return convidar(comoConta(ctx), ctx.businessId, i, ctx.clock())
}

export async function changeAccessRole(ctx: TenantContext, membershipId: string, role: MembershipRole): Promise<TeamMember> {
  authorize(ctx, 'manage_team')
  const papel = parse(papelSchema, role)
  return alterarVinculo(comoConta(ctx), ctx.businessId, membershipId, (atual) => ({ role: papel, active: atual.active }), ctx.clock())
}

export async function setAccessActive(ctx: TenantContext, membershipId: string, active: boolean): Promise<TeamMember> {
  authorize(ctx, 'manage_team')
  return alterarVinculo(comoConta(ctx), ctx.businessId, membershipId, (atual) => ({ role: atual.role, active }), ctx.clock())
}

/** Manda um convite novo (e invalida o anterior) a quem ainda não definiu a senha. */
export async function resendAccessInvite(ctx: TenantContext, membershipId: string): Promise<void> {
  authorize(ctx, 'manage_team')
  return reenviarConvite(comoConta(ctx), ctx.businessId, membershipId, ctx.clock())
}

/** Manda o link de redefinição de senha ao membro. O suporte não dispara redefinição de senha de ninguém. */
export async function sendAccessPasswordReset(ctx: TenantContext, membershipId: string): Promise<void> {
  authorize(ctx, 'manage_team')
  if (ctx.actor.kind !== 'member') {
    throw new DomainError('forbidden', 'O suporte não pode mandar redefinição de senha. Peça a um dono ou gerente da conta.')
  }
  return enviarRedefinicao(comoConta(ctx), ctx.businessId, membershipId, ctx.clock())
}
