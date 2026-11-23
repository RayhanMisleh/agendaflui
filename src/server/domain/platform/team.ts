import 'server-only'
import { assertPlatformAdmin, requireActiveAdmin, type PlatformAdminActor } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import type { MembershipRole } from '@/server/db/generated/client'
import { parse } from '@/server/domain/errors'
import { alterarVinculo, contaDoVinculo, contaInexistente, convidar, listarEquipe, papelSchema, reenviarConvite, UUID, type Autor, type TeamMember } from './access-core'

export type { TeamMember } from './access-core'

/*
 * Porta do admin da plataforma (painel dev) para a equipe de uma conta. Fina: confere o admin e entrega ao núcleo
 * compartilhado (`access-core.ts`), o mesmo que a porta do dono e do gerente usa.
 */

const comoAdmin = (actor: PlatformAdminActor): Autor => ({ kind: 'admin', actor })

/** Equipe da conta (todos os vínculos, ativos ou não), do mais antigo ao mais novo. */
export async function listTeam(actor: PlatformAdminActor, businessId: string): Promise<TeamMember[]> {
  assertPlatformAdmin(actor)
  await requireActiveAdmin(prisma, actor)
  if (!UUID.test(businessId) || !(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }))) {
    throw contaInexistente()
  }
  return listarEquipe(businessId)
}

/**
 * Convida uma pessoa para a equipe da conta. E-mail de usuário que já existe só cria o vínculo (nome e senha dele ficam como
 * estão) e manda o aviso de acesso; quem ainda não tem senha, ou é novo, recebe o convite para definir a senha. A mesma
 * pessoa duas vezes na conta é `conflict`. O e-mail sai depois do commit.
 */
export async function inviteMember(
  actor: PlatformAdminActor,
  businessId: string,
  input: { name: string; email: string; role: MembershipRole },
  now: Date = new Date(),
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  return convidar(comoAdmin(actor), businessId, input, now)
}

export async function changeMemberRole(
  actor: PlatformAdminActor,
  membershipId: string,
  role: MembershipRole,
  now: Date = new Date(),
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  const papel = parse(papelSchema, role)
  return alterarVinculo(comoAdmin(actor), await contaDoVinculo(membershipId), membershipId, (atual) => ({ role: papel, active: atual.active }), now)
}

export async function setMemberActive(
  actor: PlatformAdminActor,
  membershipId: string,
  active: boolean,
  now: Date = new Date(),
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  return alterarVinculo(comoAdmin(actor), await contaDoVinculo(membershipId), membershipId, (atual) => ({ role: atual.role, active }), now)
}

/** Manda um convite novo (e invalida o anterior) a quem ainda não definiu a senha. Só para acesso ativo. Diz se o e-mail saiu. */
export async function resendInvite(actor: PlatformAdminActor, membershipId: string, now: Date = new Date()): Promise<{ inviteMailFailed: boolean }> {
  assertPlatformAdmin(actor)
  return reenviarConvite(comoAdmin(actor), await contaDoVinculo(membershipId), membershipId, now)
}
