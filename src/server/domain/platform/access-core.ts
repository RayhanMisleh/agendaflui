import 'server-only'
import { areaLink } from '@/server/area-links'
import type { TenantContext } from '@/server/auth/actor'
import { revokeMemberTokensIn } from '@/server/auth/api-tokens'
import { can } from '@/server/auth/capabilities'
import { INVITE_TTL_DAYS, issueInvite } from '@/server/auth/invites'
import { issuePanelPasswordReset, PANEL_RESET_TTL_MINUTES } from '@/server/auth/password-reset'
import { assertPlatformAdmin, requireActiveAdmin, type PlatformAdminActor } from '@/server/auth/platform-actor'
import { roleLabel } from '@/server/auth/role-labels'
import { prisma } from '@/server/db/client'
import type { MembershipRole, Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { auditIn, auditPlatform } from '@/server/domain/audit'
import { searchKey } from '@/server/domain/customers/contact'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { renderAccessGranted, renderMemberInvite } from '@/server/notifications/render-invite'
import { renderPanelPasswordReset } from '@/server/notifications/render-password-reset'
import { emailSchema, personNameSchema } from './schemas'

/*
 * Núcleo dos acessos da equipe de uma conta, compartilhado pelas duas portas: `platform/team.ts` (admin da plataforma, no
 * painel dev) e `team/access.ts` (dono e gerente, no painel do negócio, e o suporte). Uma só implementação da regra do
 * último dono, da revogação de sessões e tokens do app, do convite e da redefinição de senha. Cada porta diz QUEM age
 * (`Autor`); o núcleo relê o autor dentro da transação (admin ativo; membro ainda ativo e com `manage_team`) e aplica as
 * regras de quem pode mexer em quem. Usa o cliente cru porque toca usuários, sessões e tokens, que `tenantDb` recusa.
 *
 * Ordem das travas (sempre esta, em toda transação deste arquivo): `business_owners` da conta, depois os vínculos
 * envolvidos (o do autor e o do alvo) em ordem crescente de id, depois a linha do usuário. Quem trava na mesma ordem nunca
 * espera em círculo.
 */

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

export type InviteInput = { name: string; email: string; role: MembershipRole; professionalId?: string | null }

/** Quem age: o admin da plataforma pelo painel dev, ou o contexto de conta (membro, ou admin em suporte). */
export type Autor = { kind: 'admin'; actor: PlatformAdminActor } | { kind: 'conta'; ctx: TenantContext }

/** O autor depois de relido no banco, dentro da transação. */
type Quem = { kind: 'admin' } | { kind: 'suporte' } | { kind: 'membro'; membershipId: string; role: MembershipRole }

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAPEIS = ['OWNER', 'MANAGER', 'PROFESSIONAL'] as const satisfies readonly MembershipRole[]
/** Quanto maior, mais poder: rebaixar é descer neste degrau. */
const DEGRAU: Record<MembershipRole, number> = { PROFESSIONAL: 0, MANAGER: 1, OWNER: 2 }

const conviteSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: z.enum(PAPEIS, 'Escolha um papel válido.'),
  professionalId: z.uuid('Escolha uma ficha de profissional válida.').nullable().optional(),
})
export const papelSchema = z.enum(PAPEIS, 'Escolha um papel válido.')

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

const NEGADO = 'Você não tem permissão para fazer isso.'
const proibido = (mensagem: string = NEGADO): DomainError => new DomainError('forbidden', mensagem)
const contaArquivada = (): DomainError =>
  new DomainError('business_unavailable', 'Esta conta está arquivada. Reative a conta antes de convidar alguém.')
export const contaInexistente = (): DomainError => new DomainError('not_found', 'Conta não encontrada.')
const vinculoInexistente = (): DomainError => new DomainError('not_found', 'Acesso da equipe não encontrado.')

class UsuarioCriadoPorOutro extends Error {}

/** Lista todos os vínculos da conta (ativos ou não), do mais antigo ao mais novo. Quem chama já conferiu a permissão. */
export async function listarEquipe(businessId: string): Promise<TeamMember[]> {
  const linhas = await prisma.membership.findMany({ where: { businessId }, select: SELECAO, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return linhas.map(paraMembro)
}

/** Conta do vínculo, para a porta do admin (que não tem conta no contexto). `not_found` se o vínculo não existe. */
export async function contaDoVinculo(membershipId: string): Promise<string> {
  if (!UUID.test(membershipId)) throw vinculoInexistente()
  const previo = await prisma.membership.findUnique({ where: { id: membershipId }, select: { businessId: true } })
  if (!previo) throw vinculoInexistente()
  return previo.businessId
}

/** Trava os vínculos em ordem crescente de id (o do autor e o do alvo): duas transações nunca esperam uma pela outra. */
async function travarVinculos(tx: Prisma.TransactionClient, businessId: string, autor: Autor, alvoId: string | null): Promise<void> {
  const ids = new Set<string>()
  if (alvoId) ids.add(alvoId.toLowerCase())
  if (autor.kind === 'conta' && autor.ctx.actor.kind === 'member') ids.add(autor.ctx.actor.membershipId.toLowerCase())
  for (const id of [...ids].sort()) await lockKeyRaw(tx, businessId, 'membership', id)
}

/**
 * Relê o autor no banco, dentro da transação da escrita: admin que não existe mais ou foi desativado, membro desativado,
 * rebaixado ou sem `manage_team` não escreve nada (o objeto do ator pode ser de antes). Só `member` e `impersonator` passam
 * na porta da conta; qualquer outro ator é `forbidden`.
 */
async function exigirAutor(tx: Prisma.TransactionClient, autor: Autor, businessId: string): Promise<Quem> {
  if (autor.kind === 'admin') {
    await requireActiveAdmin(tx, autor.actor)
    return { kind: 'admin' }
  }
  const { ctx } = autor
  if (ctx.businessId !== businessId) throw proibido()
  const ator = ctx.actor
  if (ator.kind === 'impersonator') {
    await requireActiveAdmin(tx, { kind: 'platform_admin', adminId: ator.adminId, name: ator.name })
    return { kind: 'suporte' }
  }
  if (ator.kind !== 'member') throw proibido()
  const m = await tx.membership.findFirst({
    where: { id: ator.membershipId, userId: ator.userId, businessId, active: true, business: { status: 'ACTIVE' } },
    select: { role: true },
  })
  if (!m || !can({ ...ator, role: m.role }, 'manage_team')) throw proibido()
  return { kind: 'membro', membershipId: ator.membershipId, role: m.role }
}

/**
 * Regras de quem pode mexer em quem, só para membros (admin e suporte têm os poderes do dono): só dono mexe em dono ou
 * promove alguém a dono; ninguém altera o próprio vínculo (papel ou situação).
 */
function conferirAlvo(quem: Quem, alvo: { id: string; role: MembershipRole }, o: { novoPapel?: MembershipRole; proprio?: boolean } = {}): void {
  if (quem.kind !== 'membro') return
  if (o.proprio && alvo.id.toLowerCase() === quem.membershipId.toLowerCase()) {
    throw proibido('Você não pode alterar o seu próprio acesso. Peça a outro dono ou gerente da conta.')
  }
  if (quem.role !== 'OWNER' && (alvo.role === 'OWNER' || o.novoPapel === 'OWNER')) {
    throw proibido('Só um dono da conta pode mexer no acesso de um dono ou torná-lo dono.')
  }
}

async function auditar(
  tx: Prisma.TransactionClient,
  autor: Autor,
  businessId: string,
  entry: { action: string; targetType: string; targetId: string; metadata?: Prisma.InputJsonObject },
): Promise<void> {
  if (autor.kind === 'admin') await auditPlatform(tx, autor.actor, { businessId, ...entry })
  else await auditIn(tx, autor.ctx, entry)
}

/**
 * Convida uma pessoa para a equipe da conta. E-mail de usuário que já existe só cria o vínculo (nome e senha dele ficam como
 * estão) e manda o aviso de acesso; quem ainda não tem senha, ou é novo, recebe o convite para definir a senha. A mesma
 * pessoa duas vezes na conta é `conflict`. Com `professionalId`, o acesso fica ligado à ficha (uma ficha tem no máximo um
 * acesso; ficha que não é desta conta ou está arquivada é `not_found`). O e-mail sai depois do commit.
 */
export async function convidar(autor: Autor, businessId: string, input: InviteInput, now: Date): Promise<TeamMember> {
  if (autor.kind === 'admin') assertPlatformAdmin(autor.actor)
  const i = parse(conviteSchema, input)
  for (let tentativa = 1; ; tentativa++) {
    try {
      const feito = await prisma.$transaction(async (tx) => {
        if (UUID.test(businessId)) await travarVinculos(tx, businessId, autor, null)
        const quem = await exigirAutor(tx, autor, businessId)
        if (quem.kind === 'membro' && quem.role !== 'OWNER' && i.role === 'OWNER') {
          throw proibido('Só um dono da conta pode convidar outro dono.')
        }
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
        if (i.professionalId) {
          // UPDATE condicional: de dois convites simultâneos para a mesma ficha, só um liga; o outro desfaz tudo.
          const ligada = await tx.professional.updateMany({
            where: { id: i.professionalId, businessId: conta.id, membershipId: null, archivedAt: null },
            data: { membershipId: vinculo.id },
          })
          if (ligada.count !== 1) {
            const ficha = await tx.professional.findFirst({ where: { id: i.professionalId, businessId: conta.id }, select: { archivedAt: true } })
            if (!ficha || ficha.archivedAt !== null) throw new DomainError('not_found', 'Profissional não encontrado.')
            throw new DomainError('conflict', 'Esta ficha de profissional já tem um acesso. Escolha outra ficha ou desligue o acesso atual.', {
              reason: 'membership_taken',
              fields: { professionalId: 'Esta ficha já está ligada a um acesso.' },
            })
          }
        }
        const convite = usuario.passwordHash === null ? await issueInvite(tx, usuario.id, now) : null
        await auditar(tx, autor, conta.id, {
          action: 'team.member_invited',
          targetType: 'membership',
          targetId: vinculo.id,
          metadata: {
            role: i.role,
            userId: usuario.id,
            existingUser: existente,
            ...(i.professionalId ? { professionalId: i.professionalId } : {}),
          },
        })
        const membro = paraMembro(await tx.membership.findUniqueOrThrow({ where: { id: vinculo.id }, select: SELECAO }))
        return { membro, conta, convite, nomeDoUsuario: usuario.name }
      })
      const { membro, conta, convite } = feito
      await deliverAccessMail(
        convite ? 'invite' : 'access_granted',
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

export type Alteracao = (atual: { role: MembershipRole; active: boolean }) => { role: MembershipRole; active: boolean }

/**
 * Altera papel ou situação de um vínculo da conta numa transação sob a trava dos donos da conta (`business_owners`) e as
 * travas dos vínculos do autor e do alvo (nesta ordem, sempre). Dono ativo que deixaria de ser dono ativo exige outro dono
 * ativo, conferido aqui dentro: duas operações simultâneas sobre os dois últimos donos se serializam e só uma passa. Quando
 * o acesso diminui (desativar ou rebaixar), revoga as sessões do painel do usuário cuja conta ativa é esta e os tokens do
 * app do vínculo; reativar não devolve nada. Vínculo de outra conta é `not_found`.
 */
export async function alterarVinculo(
  autor: Autor,
  businessId: string,
  membershipId: string,
  alterar: Alteracao,
  now: Date,
): Promise<TeamMember> {
  if (autor.kind === 'admin') assertPlatformAdmin(autor.actor)
  if (!UUID.test(membershipId) || !UUID.test(businessId)) throw vinculoInexistente()
  return prisma.$transaction(async (tx) => {
    await lockKeyRaw(tx, businessId, 'business_owners', businessId)
    await travarVinculos(tx, businessId, autor, membershipId)
    const quem = await exigirAutor(tx, autor, businessId)
    const atual = await tx.membership.findFirst({ where: { id: membershipId, businessId }, select: SELECAO })
    if (!atual) throw vinculoInexistente()
    const novo = alterar({ role: atual.role, active: atual.active })
    conferirAlvo(quem, { id: atual.id, role: atual.role }, { proprio: true, novoPapel: novo.role })
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
    // Quem fica sem nenhum acesso ativo não define nem redefine a senha por um link antigo.
    if (desativou && (await tx.membership.count({ where: { userId: atual.user.id, active: true } })) === 0) {
      await tx.userToken.deleteMany({ where: { userId: atual.user.id, purpose: { in: ['INVITE', 'PASSWORD_RESET'] }, usedAt: null } })
    }
    if (novo.role !== atual.role) {
      await auditar(tx, autor, businessId, {
        action: 'team.role_changed',
        targetType: 'membership',
        targetId: membershipId,
        metadata: { from: atual.role, to: novo.role },
      })
    }
    if (novo.active !== atual.active) {
      await auditar(tx, autor, businessId, {
        action: novo.active ? 'team.member_activated' : 'team.member_deactivated',
        targetType: 'membership',
        targetId: membershipId,
        metadata: { role: novo.role },
      })
    }
    return paraMembro(await tx.membership.findUniqueOrThrow({ where: { id: membershipId }, select: SELECAO }))
  })
}

const MEMBRO = {
  id: true,
  role: true,
  active: true,
  business: { select: { name: true, status: true } },
  user: { select: { id: true, name: true, email: true, passwordHash: true } },
} satisfies Prisma.MembershipSelect

/** Manda um convite novo (e invalida o anterior) a quem ainda não definiu a senha. Só para acesso ativo. */
export async function reenviarConvite(autor: Autor, businessId: string, membershipId: string, now: Date): Promise<void> {
  if (autor.kind === 'admin') assertPlatformAdmin(autor.actor)
  if (!UUID.test(membershipId) || !UUID.test(businessId)) throw vinculoInexistente()
  const feito = await prisma.$transaction(async (tx) => {
    await travarVinculos(tx, businessId, autor, membershipId)
    const quem = await exigirAutor(tx, autor, businessId)
    const m = await tx.membership.findFirst({ where: { id: membershipId, businessId }, select: MEMBRO })
    if (!m) throw vinculoInexistente()
    conferirAlvo(quem, { id: m.id, role: m.role })
    if (m.business.status === 'ARCHIVED') throw contaArquivada()
    if (!m.active) throw new DomainError('conflict', 'Este acesso está desativado. Reative-o antes de mandar um convite.')
    if (m.user.passwordHash !== null) {
      throw new DomainError('conflict', 'Esta pessoa já definiu a senha. Convite só vale para quem ainda não tem senha.')
    }
    const convite = await issueInvite(tx, m.user.id, now)
    await auditar(tx, autor, businessId, { action: 'team.invite_resent', targetType: 'membership', targetId: membershipId })
    return { m, convite }
  })
  await deliverAccessMail(
    'invite',
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

/**
 * Manda o link de redefinição de senha a um membro ativo que já tem senha (o token anterior deixa de valer). Só dono e
 * gerente: o suporte e o admin nunca disparam redefinição de senha de ninguém. Gerente não manda a um dono.
 */
export async function enviarRedefinicao(autor: Autor, businessId: string, membershipId: string, now: Date): Promise<void> {
  if (autor.kind !== 'conta' || autor.ctx.actor.kind !== 'member') throw proibido()
  if (!UUID.test(membershipId) || !UUID.test(businessId)) throw vinculoInexistente()
  const feito = await prisma.$transaction(async (tx) => {
    await travarVinculos(tx, businessId, autor, membershipId)
    const quem = await exigirAutor(tx, autor, businessId)
    const m = await tx.membership.findFirst({ where: { id: membershipId, businessId }, select: MEMBRO })
    if (!m) throw vinculoInexistente()
    conferirAlvo(quem, { id: m.id, role: m.role })
    if (!m.active) throw new DomainError('conflict', 'Este acesso está desativado. Reative-o antes de mandar a redefinição de senha.')
    if (m.user.passwordHash === null) {
      throw new DomainError('conflict', 'Esta pessoa ainda não definiu a senha. Reenvie o convite para ela escolher a senha.')
    }
    const emitido = await issuePanelPasswordReset(tx, m.user.id, now)
    await auditar(tx, autor, businessId, { action: 'team.password_reset_sent', targetType: 'membership', targetId: membershipId })
    return { m, emitido }
  })
  await deliverAccessMail(
    'password_reset',
    feito.m.user.email,
    renderPanelPasswordReset({
      name: feito.m.user.name,
      businessName: feito.m.business.name,
      link: areaLink('painel', `/redefinir-senha/${feito.emitido.token}`),
      ttlMin: PANEL_RESET_TTL_MINUTES,
    }),
  )
}
