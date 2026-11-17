import 'server-only'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { DomainError, parse, z } from '@/server/domain/errors'
import { emailSchema } from '@/server/domain/platform/schemas'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { isSafeRecipient } from '@/server/notifications/channels/types'
import { renderMemberInvite } from '@/server/notifications/render-invite'
import { renderPanelPasswordReset } from '@/server/notifications/render-password-reset'
import { roleLabel } from './role-labels'
import { addMinutes } from '@/server/time'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { INVITE_TTL_DAYS, issueInvite } from './invites'
import { hashPassword, passwordSchema } from './password'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import type { RequestMeta } from './support-session'
import { generateToken, hashToken } from './tokens'

/*
 * Redefinição de senha do painel (donos e equipe). Token opaco de 32 bytes (no banco só o hash), 60 minutos, uso único
 * por UPDATE condicional, um token vivo por usuário. "Esqueci a senha" não revela se o e-mail existe: a parte síncrona é
 * igual para todos e tudo que depende do e-mail roda na continuação, depois da resposta. Quem ainda não definiu a senha
 * (convite pendente) recebe o convite de novo: convite e redefinição têm o mesmo efeito (definir a senha de quem prova
 * o e-mail), então não existe um segundo caminho para quem nunca aceitou o convite.
 */

export const PANEL_RESET_TTL_MINUTES = 60

/** Mesma frase para link inexistente, vencido, usado ou de quem perdeu o acesso: a tela não revela qual dos casos aconteceu. */
export const RESET_INVALID_MESSAGE = 'Este link não vale mais. Peça um novo em "Esqueci a senha" na tela de entrada.'

const invalido = (): DomainError => new DomainError('not_found', RESET_INVALID_MESSAGE)

export type ResetTx = Prisma.TransactionClient

/**
 * Trava a linha do usuário até o fim da transação (sem bloquear quem só lê nem as chaves estrangeiras de outras tabelas):
 * serializa emissão, redefinição e troca de senha da mesma pessoa. Nas transações que também pegam travas de vínculo, esta
 * vem primeiro.
 */
export async function lockUser(tx: ResetTx, userId: string): Promise<void> {
  await tx.$queryRaw`select id from users where id = ${userId}::uuid for no key update`
}

/** Emite o token de redefinição e apaga o anterior ainda não usado. O token em texto só existe neste retorno, para ir no e-mail. */
export async function issuePanelPasswordReset(tx: ResetTx, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  await lockUser(tx, userId)
  await tx.userToken.deleteMany({ where: { userId, purpose: 'PASSWORD_RESET', usedAt: null } })
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, PANEL_RESET_TTL_MINUTES)
  await tx.userToken.create({ data: { userId, purpose: 'PASSWORD_RESET', tokenHash: hash, expiresAt } })
  return { token, expiresAt }
}

/**
 * Revoga as sessões do painel do usuário (todas, de qualquer conta, menos a do token indicado) e os tokens do app de todos
 * os vínculos dele, ativos ou não. Os vínculos são travados em ordem crescente de id, a mesma de quem trava mais de um
 * (`lockMemberships`), para duas transações nunca esperarem uma pela outra. Chame depois de `lockUser`.
 */
export async function revokeUserAccess(tx: ResetTx, userId: string, now: Date, keepSessionToken?: string): Promise<void> {
  const vinculos = await tx.membership.findMany({ where: { userId }, select: { id: true, businessId: true }, orderBy: { id: 'asc' } })
  for (const v of vinculos) await lockKeyRaw(tx, v.businessId, 'membership', v.id)
  await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionToken ? { NOT: { tokenHash: hashToken(keepSessionToken) } } : {}) },
    data: { revokedAt: now },
  })
  if (vinculos.length > 0) {
    await tx.refreshToken.updateMany({
      where: { membershipId: { in: vinculos.map((v) => v.id) }, revokedAt: null },
      data: { revokedAt: now },
    })
  }
}

const pedidoSchema = z.object({
  email: emailSchema.refine(isSafeRecipient, 'Informe um e-mail válido, por exemplo nome@exemplo.com.'),
})

/** Conta o pedido: origem primeiro (um IP barrado não gasta o teto do e-mail), depois o e-mail (3 em 15 minutos, 6 por dia). */
async function allowRequest(email: string, ip: string | null | undefined, now: Date): Promise<boolean> {
  if (ip) {
    const porIp = await hitRateLimit(limitKey('redefinir-painel:ip', ipLimitKeyPart(ip)), LIMITS.panelResetIp, now)
    if (!porIp.allowed) return false
  }
  const curto = await hitRateLimit(limitKey('redefinir-painel:email', email), LIMITS.codeEmail, now)
  if (!curto.allowed) return false
  return (await hitRateLimit(limitKey('redefinir-painel-dia:email', email), LIMITS.codeEmailDaily, now)).allowed
}

/**
 * "Esqueci a senha". Duas partes, para a resposta (e o tempo dela) ser a mesma exista o e-mail ou não: esta função só valida o
 * formato do e-mail (422 igual para todos) e DEVOLVE a continuação, que a rota agenda para depois da resposta
 * (`runAfterResponse`): limites, consulta, token e envio. Sem vínculo ativo numa conta ativa: nada é enviado.
 */
export async function requestPanelPasswordReset(email: string, meta: RequestMeta, now: Date): Promise<() => Promise<void>> {
  const i = parse(pedidoSchema, { email })
  return async () => {
    if (!(await allowRequest(i.email, meta.ip, now))) return
    const usuario = await prisma.user.findUnique({
      where: { email: i.email },
      select: {
        id: true,
        name: true,
        passwordHash: true,
        memberships: {
          where: { active: true, business: { status: 'ACTIVE' } },
          select: { role: true, business: { select: { name: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
    })
    const vinculo = usuario?.memberships[0]
    if (!usuario || !vinculo) return
    if (usuario.passwordHash === null) {
      const convite = await prisma.$transaction(async (tx) => {
        await lockUser(tx, usuario.id)
        const atual = await tx.user.findUnique({ where: { id: usuario.id }, select: { passwordHash: true } })
        // Definiu a senha entre a consulta e a trava: o convite não vale mais, e o pedido acaba aqui.
        return atual?.passwordHash === null ? issueInvite(tx, usuario.id, now) : null
      })
      if (!convite) return
      await deliverAccessMail(
        'invite',
        i.email,
        renderMemberInvite({
          name: usuario.name,
          businessName: vinculo.business.name,
          roleLabel: roleLabel(vinculo.role, 'Profissional'),
          link: areaLink('painel', `/definir-senha/${convite.token}`),
          ttlDays: INVITE_TTL_DAYS,
        }),
      )
      return
    }
    const emitido = await prisma.$transaction((tx) => issuePanelPasswordReset(tx, usuario.id, now))
    await deliverAccessMail(
      'password_reset',
      i.email,
      renderPanelPasswordReset({
        name: usuario.name,
        link: areaLink('painel', `/redefinir-senha/${emitido.token}`),
        ttlMin: PANEL_RESET_TTL_MINUTES,
      }),
    )
  }
}

/** Token vivo de redefinição de quem ainda tem vínculo ativo: a condição que `readPanelPasswordReset` e a troca usam. */
const tokenVivo = (hash: string, now: Date): Prisma.UserTokenWhereInput => ({
  tokenHash: hash,
  purpose: 'PASSWORD_RESET',
  usedAt: null,
  expiresAt: { gt: now },
  user: { memberships: { some: { active: true } } },
})

/** E-mail de quem recebeu o link, ou `null` se o token não existe, venceu, já foi usado ou a pessoa perdeu o acesso. */
export async function readPanelPasswordReset(token: string, now: Date): Promise<{ email: string } | null> {
  if (token === '') return null
  const linha = await prisma.userToken.findFirst({ where: tokenVivo(hashToken(token), now), select: { user: { select: { email: true } } } })
  return linha ? { email: linha.user.email } : null
}

const novaSenhaSchema = z.object({ password: passwordSchema })

/**
 * Define a senha nova com o link. O token é consumido por um UPDATE condicional: de duas redefinições simultâneas só uma
 * passa. Na mesma transação, revoga todas as sessões do painel da pessoa e os tokens do app de todos os vínculos dela.
 * Link que não vale: `not_found` com a mesma frase em todos os casos.
 */
export async function resetPanelPassword(i: { token: string; password: string }, _meta: RequestMeta, now: Date): Promise<void> {
  const { password } = parse(novaSenhaSchema, { password: i.password })
  if ((await readPanelPasswordReset(i.token, now)) === null) throw invalido()
  const passwordHash = await hashPassword(password)
  const tokenHash = hashToken(i.token)
  await prisma.$transaction(async (tx) => {
    const usado = await tx.userToken.updateMany({ where: tokenVivo(tokenHash, now), data: { usedAt: now } })
    if (usado.count !== 1) throw invalido()
    const { userId } = await tx.userToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } })
    await lockUser(tx, userId)
    // Quem perdeu o último vínculo ativo entre a leitura e a trava não troca a senha (a transação desfaz o consumo do token).
    if ((await tx.membership.count({ where: { userId, active: true } })) === 0) throw invalido()
    await tx.user.update({ where: { id: userId }, data: { passwordHash } })
    await tx.userToken.deleteMany({ where: { userId, purpose: { in: ['PASSWORD_RESET', 'INVITE'] }, usedAt: null } })
    await revokeUserAccess(tx, userId, now)
  })
}

/**
 * Conta uma tentativa de redefinir. Com IP confiável, por IP (IPv6 como /64); sem IP, por token (token lixo nunca atrapalha
 * a redefinição de outra pessoa).
 */
export async function checkPanelResetLimit(ip: string | undefined, token: string, now: Date): Promise<void> {
  const chave = ip ? limitKey('redefinir:ip', ipLimitKeyPart(ip)) : limitKey('redefinir:token', hashToken(token))
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
