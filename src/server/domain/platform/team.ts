import 'server-only'
import { areaLink } from '@/server/area-links'
import { revokeMemberTokensIn } from '@/server/auth/api-tokens'
import { INVITE_TTL_DAYS, issueInvite } from '@/server/auth/invites'
import { assertPlatformAdmin, requireActiveAdmin, type PlatformAdminActor } from '@/server/auth/platform-actor'
import { roleLabel } from '@/server/auth/role-labels'
import { prisma } from '@/server/db/client'
import type { MembershipRole, Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { searchKey } from '@/server/domain/customers/contact'
import { auditPlatform } from '@/server/domain/audit'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { getEmailChannel } from '@/server/notifications/channels'
import { isSafeRecipient, maskEmail } from '@/server/notifications/channels/types'
import { renderAccessGranted, renderMemberInvite } from '@/server/notifications/render-invite'
import type { RenderedMail } from '@/server/notifications/render-account'
import { emailSchema, personNameSchema } from './schemas'

export type TeamMember = {
  membershipId: string
  userId: string
  name: string
  email: string
  role: MembershipRole
  active: boolean
  hasPassword: boolean
  lastLoginAt: Date | null
  professionalId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAPEIS = ['OWNER', 'MANAGER', 'PROFESSIONAL'] as const satisfies readonly MembershipRole[]
/** Quanto maior, mais poder: rebaixar é descer neste degrau. */
const DEGRAU: Record<MembershipRole, number> = { PROFESSIONAL: 0, MANAGER: 1, OWNER: 2 }

const conviteSchema = z.object({ name: personNameSchema, email: emailSchema, role: z.enum(PAPEIS, 'Escolha um papel válido.') })
const papelSchema = z.enum(PAPEIS, 'Escolha um papel válido.')

const SELECAO = {
  id: true,
  businessId: true,
  role: true,
  active: true,
  user: { select: { id: true, name: true, email: true, passwordHash: true, lastLoginAt: true } },
  professionals: { select: { id: true }, take: 1 },
} satisfies Prisma.MembershipSelect

type Bruto = Prisma.MembershipGetPayload<{ select: typeof SELECAO }>

function paraMembro(m: Bruto): TeamMember {
  return {
    membershipId: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    active: m.active,
    hasPassword: m.user.passwordHash !== null,
    lastLoginAt: m.user.lastLoginAt,
    professionalId: m.professionals[0]?.id ?? null,
  }
}

const contaArquivada = (): DomainError =>
  new DomainError('business_unavailable', 'Esta conta está arquivada. Reative a conta antes de convidar alguém.')

const contaInexistente = (): DomainError => new DomainError('not_found', 'Conta não encontrada.')
const vinculoInexistente = (): DomainError => new DomainError('not_found', 'Acesso da equipe não encontrado.')

class UsuarioCriadoPorOutro extends Error {}

/** Envia o e-mail depois do commit. Falha ou falta de canal não desfaz nada: só vai para o log, sem o corpo nem o link. */
async function enviar(to: string, mail: RenderedMail): Promise<void> {
  const channel = getEmailChannel()
  if (!channel || !isSafeRecipient(to)) {
    console.warn(JSON.stringify({ level: 'warn', event: 'team_mail_skipped', to: maskEmail(to) }))
    return
  }
  try {
    await channel.send({ to, fromName: 'AgendaFlui', ...mail })
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', event: 'team_mail_failed', to: maskEmail(to), error: err instanceof Error ? err.name : 'unknown' }),
    )
  }
}

/** Equipe da conta (todos os vínculos, ativos ou não), do mais antigo ao mais novo. */
export async function listTeam(actor: PlatformAdminActor, businessId: string): Promise<TeamMember[]> {
  assertPlatformAdmin(actor)
  await requireActiveAdmin(prisma, actor)
  if (!UUID.test(businessId) || !(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }))) {
    throw contaInexistente()
  }
  const linhas = await prisma.membership.findMany({ where: { businessId }, select: SELECAO, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return linhas.map(paraMembro)
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
  const i = parse(conviteSchema, input)
  for (let tentativa = 1; ; tentativa++) {
    try {
      const feito = await prisma.$transaction(async (tx) => {
        await requireActiveAdmin(tx, actor)
        const conta = UUID.test(businessId)
          ? await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, slug: true, status: true } })
          : null
        if (!conta) throw contaInexistente()
        if (conta.status === 'ARCHIVED') throw contaArquivada()
        let usuario = await tx.user.findUnique({ where: { email: i.email }, select: { id: true, name: true, passwordHash: true } })
        const existente = usuario !== null
        if (usuario === null) {
          try {
            usuario = await tx.user.create({
              data: { name: i.name, searchName: searchKey(i.name), email: i.email },
              select: { id: true, name: true, passwordHash: true },
            })
          } catch (err) {
            if (isUniqueViolation(err)) throw new UsuarioCriadoPorOutro()
            throw err
          }
        }
        let vinculo: { id: string }
        try {
          vinculo = await tx.membership.create({ data: { businessId: conta.id, userId: usuario.id, role: i.role }, select: { id: true } })
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new DomainError('conflict', 'Esta pessoa já faz parte da equipe desta conta. Se o acesso está desativado, reative-o na lista.')
          }
          throw err
        }
        const convite = usuario.passwordHash === null ? await issueInvite(tx, usuario.id, now) : null
        await auditPlatform(tx, actor, {
          businessId: conta.id,
          action: 'team.member_invited',
          targetType: 'membership',
          targetId: vinculo.id,
          metadata: { role: i.role, userId: usuario.id, existingUser: existente },
        })
        const membro = paraMembro(await tx.membership.findUniqueOrThrow({ where: { id: vinculo.id }, select: SELECAO }))
        return { membro, conta, convite, nomeDoUsuario: usuario.name }
      })
      const { membro, conta, convite } = feito
      await enviar(
        membro.email,
        convite
          ? renderMemberInvite({
              name: feito.nomeDoUsuario,
              businessName: conta.name,
              roleLabel: roleLabel(i.role, 'Profissional'),
              link: areaLink('painel', `/definir-senha/${convite.token}`),
              ttlDays: INVITE_TTL_DAYS,
            })
          : renderAccessGranted({ ownerName: feito.nomeDoUsuario, businessName: conta.name, entryLink: areaLink('painel', `/entrar/${conta.slug}`) }),
      )
      return membro
    } catch (err) {
      // Outro convite criou o mesmo usuário no meio do caminho: a nova tentativa o encontra e só cria o vínculo.
      if (err instanceof UsuarioCriadoPorOutro && tentativa < 2) continue
      if (err instanceof UsuarioCriadoPorOutro) {
        throw new DomainError('conflict', 'Esta pessoa acabou de ser cadastrada por outro convite. Tente de novo.')
      }
      throw err
    }
  }
}

type Alteracao = (atual: { role: MembershipRole; active: boolean }) => { role: MembershipRole; active: boolean }

/**
 * Altera papel ou situação de um vínculo numa transação sob a trava dos donos da conta (`business_owners`) e a trava do vínculo (nesta ordem,
 * sempre). Dono ativo que deixaria de ser dono ativo exige outro dono ativo, conferido aqui dentro: duas operações
 * simultâneas sobre os dois últimos donos se serializam e só uma passa. Quando o acesso diminui (desativar ou rebaixar),
 * revoga as sessões do painel do usuário cuja conta ativa é esta e os tokens do app do vínculo; reativar não devolve nada.
 */
async function alterarVinculo(
  actor: PlatformAdminActor,
  membershipId: string,
  alterar: Alteracao,
  now: Date,
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  if (!UUID.test(membershipId)) throw vinculoInexistente()
  const previo = await prisma.membership.findUnique({ where: { id: membershipId }, select: { businessId: true } })
  if (!previo) throw vinculoInexistente()
  const { businessId } = previo
  return prisma.$transaction(async (tx) => {
    await lockKeyRaw(tx, businessId, 'business_owners', businessId)
    await lockKeyRaw(tx, businessId, 'membership', membershipId)
    await requireActiveAdmin(tx, actor)
    const atual = await tx.membership.findUnique({ where: { id: membershipId }, select: SELECAO })
    if (!atual) throw vinculoInexistente()
    const novo = alterar({ role: atual.role, active: atual.active })
    if (novo.role === atual.role && novo.active === atual.active) return paraMembro(atual)

    // Dono com convite pendente (ainda sem senha) conta como dono ativo: a conta não fica órfã, porque o admin pode reenviar
    // o convite (`resendInvite`) ou entrar em suporte. Por isso o filtro abaixo olha só vínculo e papel, não a senha.
    const deixaDeSerDonoAtivo = atual.role === 'OWNER' && atual.active && !(novo.role === 'OWNER' && novo.active)
    if (deixaDeSerDonoAtivo) {
      const outros = await tx.membership.count({ where: { businessId, role: 'OWNER', active: true, id: { not: membershipId } } })
      if (outros === 0) {
        throw new DomainError(
          'conflict',
          'Esta conta ficaria sem nenhum dono ativo. Torne outra pessoa dona da conta antes de rebaixar ou desativar este acesso.',
        )
      }
    }
    await tx.membership.update({ where: { id: membershipId }, data: { role: novo.role, active: novo.active } })

    const rebaixou = DEGRAU[novo.role] < DEGRAU[atual.role]
    const desativou = atual.active && !novo.active
    if (rebaixou || desativou) {
      await tx.session.updateMany({
        where: { userId: atual.user.id, activeBusinessId: businessId, revokedAt: null },
        data: { revokedAt: now },
      })
      await revokeMemberTokensIn(tx, businessId, membershipId, now)
    }
    // Quem fica sem nenhum acesso ativo e ainda não tem senha não pode definir a senha por um link antigo.
    if (desativou && atual.user.passwordHash === null && (await tx.membership.count({ where: { userId: atual.user.id, active: true } })) === 0) {
      await tx.userToken.deleteMany({ where: { userId: atual.user.id, purpose: 'INVITE', usedAt: null } })
    }
    if (novo.role !== atual.role) {
      await auditPlatform(tx, actor, {
        businessId,
        action: 'team.role_changed',
        targetType: 'membership',
        targetId: membershipId,
        metadata: { from: atual.role, to: novo.role },
      })
    }
    if (novo.active !== atual.active) {
      await auditPlatform(tx, actor, {
        businessId,
        action: novo.active ? 'team.member_activated' : 'team.member_deactivated',
        targetType: 'membership',
        targetId: membershipId,
        metadata: { role: novo.role },
      })
    }
    return paraMembro(await tx.membership.findUniqueOrThrow({ where: { id: membershipId }, select: SELECAO }))
  })
}

export async function changeMemberRole(
  actor: PlatformAdminActor,
  membershipId: string,
  role: MembershipRole,
  now: Date = new Date(),
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  const papel = parse(papelSchema, role)
  return alterarVinculo(actor, membershipId, (atual) => ({ role: papel, active: atual.active }), now)
}

export async function setMemberActive(
  actor: PlatformAdminActor,
  membershipId: string,
  active: boolean,
  now: Date = new Date(),
): Promise<TeamMember> {
  assertPlatformAdmin(actor)
  return alterarVinculo(actor, membershipId, (atual) => ({ role: atual.role, active }), now)
}

/** Manda um convite novo (e invalida o anterior) a quem ainda não definiu a senha. Só para acesso ativo. */
export async function resendInvite(actor: PlatformAdminActor, membershipId: string, now: Date = new Date()): Promise<void> {
  assertPlatformAdmin(actor)
  if (!UUID.test(membershipId)) throw vinculoInexistente()
  const previo = await prisma.membership.findUnique({ where: { id: membershipId }, select: { businessId: true } })
  if (!previo) throw vinculoInexistente()
  const { businessId } = previo
  const feito = await prisma.$transaction(async (tx) => {
    await lockKeyRaw(tx, businessId, 'membership', membershipId)
    await requireActiveAdmin(tx, actor)
    const m = await tx.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, role: true, active: true, business: { select: { name: true, status: true } }, user: { select: { id: true, name: true, email: true, passwordHash: true } } },
    })
    if (!m) throw vinculoInexistente()
    if (m.business.status === 'ARCHIVED') throw contaArquivada()
    if (!m.active) throw new DomainError('conflict', 'Este acesso está desativado. Reative-o antes de mandar um convite.')
    if (m.user.passwordHash !== null) {
      throw new DomainError('conflict', 'Esta pessoa já definiu a senha. Convite só vale para quem ainda não tem senha.')
    }
    const convite = await issueInvite(tx, m.user.id, now)
    await auditPlatform(tx, actor, { businessId, action: 'team.invite_resent', targetType: 'membership', targetId: membershipId })
    return { m, convite }
  })
  await enviar(
    feito.m.user.email,
    renderMemberInvite({
      name: feito.m.user.name,
      businessName: feito.m.business.name,
      roleLabel: roleLabel(feito.m.role, 'Profissional'),
      link: areaLink('painel', `/definir-senha/${feito.convite.token}`),
      ttlDays: INVITE_TTL_DAYS,
    }),
  )
}
