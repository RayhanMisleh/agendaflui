import 'server-only'
import { disconnectCalendarIn, getCalendarStatus, revokeSealedLater } from '@/server/calendar/connection'
import type { CalendarStatusView } from '@/server/calendar/connection'
import { prisma } from '@/server/db/client'
import { normalizePhone, formatPhone, searchKey } from '@/server/domain/customers/contact'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { emailSchema, personNameSchema } from '@/server/domain/platform/schemas'
import { isSafeRecipient } from '@/server/notifications/channels/types'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { renderEmailChangeCode } from '@/server/notifications/render-account'
import { emailChangeUnlinksGoogle } from '@/shared/person'
import { formatDateTime, toIsoInstant } from '@/server/time'
import { AuthError } from './actor'
import {
  allowCodeRequest,
  assertCodeGuessesLeft,
  clearCodeFailures,
  CODE_TTL_MINUTES,
  confirmEmailCode,
  countCodeFailure,
  invalidCode,
  issueEmailCode,
} from './email-code'
import { fakePasswordHash, hashPassword, passwordSchema, verifyPassword } from './password'
import { lockUserAccess, revokeUserAccess } from './password-reset'
import { syncCustomerCopies } from './person'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { roleLabel } from './role-labels'
import { setSessionStore } from './session'

/*
 * Minha conta: tudo que a pessoa muda em si mesma (dados, senha, e-mail, Google, loja atual). A pessoa é global; nome,
 * telefone e e-mail também vivem como cópia em cada cliente dela, e as cópias mudam na MESMA transação que a pessoa.
 * Invariante: nenhuma ação aqui deixa a pessoa sem senha e sem Google (ela ficaria trancada fora).
 */

export type PersonAccountView = {
  name: string
  email: string
  phone: string | null
  phoneLabel: string | null
  hasPassword: boolean
  google: { email: string; linkedAt: Date } | null
  googleAvailable: boolean
  /** Google Agenda: só para a equipe (`null` para os demais). `available` = Google configurado e vinculado. */
  calendar: (CalendarStatusView & { available: boolean; hasGoogle: boolean; syncedLabel: string | null }) | null
  stores: { businessId: string; slug: string; name: string; current: boolean }[]
  staff: { businessName: string; roleLabel: string; canWatchAll: boolean; watchAll: boolean } | null
}

const SENHA_PRIMEIRO = 'Crie uma senha antes de desvincular, para não perder o acesso.'
const SENHA_ANTES_DO_EMAIL = 'Crie uma senha antes de trocar o e-mail.'

const precisaDeSenha = (mensagem: string): DomainError => new DomainError('conflict', mensagem, { reason: 'needs_password' })

/** Lê a pessoa, a equipe e as lojas dela para a tela. `customerBusinessId` é a última loja usada (marca a atual). */
export async function getPersonAccount(userId: string, customerBusinessId: string | null): Promise<PersonAccountView> {
  const pessoa = await prisma.user.findUnique({ where: { id: userId } })
  if (!pessoa) throw new DomainError('not_found', 'Conta não encontrada.')
  const [clientes, vinculo, googleAvailable, agenda] = await Promise.all([
    prisma.customer.findMany({
      where: { userId, archivedAt: null, anonymizedAt: null, business: { status: 'ACTIVE' } },
      select: { businessId: true, business: { select: { slug: true, name: true, branding: { select: { displayName: true } } } } },
    }),
    prisma.membership.findFirst({
      where: { userId, active: true, business: { status: 'ACTIVE' } },
      select: { role: true, notifyAllAppointments: true, business: { select: { name: true, timezone: true, branding: { select: { displayName: true } } } } },
    }),
    isGoogleConfigured(),
    getCalendarStatus(userId),
  ])
  const stores = clientes
    .map((c) => ({
      businessId: c.businessId,
      slug: c.business.slug,
      name: c.business.branding?.displayName || c.business.name,
      current: c.businessId === customerBusinessId,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
  return {
    name: pessoa.name,
    email: pessoa.email,
    phone: pessoa.phone,
    phoneLabel: pessoa.phone ? formatPhone(pessoa.phone) : null,
    hasPassword: pessoa.passwordHash !== null,
    google:
      pessoa.googleSub !== null && pessoa.googleEmail !== null && pessoa.googleLinkedAt !== null
        ? { email: pessoa.googleEmail, linkedAt: pessoa.googleLinkedAt }
        : null,
    googleAvailable,
    calendar: vinculo
      ? {
          ...agenda,
          available: googleAvailable && pessoa.googleSub !== null,
          hasGoogle: pessoa.googleSub !== null,
          syncedLabel: agenda.lastSyncedAt ? formatDateTime(agenda.lastSyncedAt, vinculo.business.timezone) : null,
        }
      : null,
    stores,
    staff: vinculo
      ? {
          businessName: vinculo.business.branding?.displayName || vinculo.business.name,
          roleLabel: roleLabel(vinculo.role),
          canWatchAll: vinculo.role === 'OWNER' || vinculo.role === 'MANAGER',
          watchAll: vinculo.notifyAllAppointments,
        }
      : null,
  }
}

const phoneField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((valor, ctx) => {
    if (valor === null || valor === undefined || valor === '') return null
    try {
      return normalizePhone(valor)
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: err instanceof RangeError ? err.message : 'Telefone inválido.' })
      return z.NEVER
    }
  })

const profileSchema = z.object({ name: personNameSchema, phone: phoneField })

/** Nome e telefone da pessoa e de todas as cópias dela (uma por loja), numa transação. Sem `phone` no pedido, o telefone fica como está. */
export async function updatePersonProfile(userId: string, input: { name: string; phone?: string | null }): Promise<void> {
  const i = parse(profileSchema, input)
  const mudaTelefone = input.phone !== undefined
  await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, userId)
    await tx.user.update({
      where: { id: userId },
      data: { name: i.name, searchName: searchKey(i.name), ...(mudaTelefone ? { phone: i.phone } : {}) },
    })
    await syncCustomerCopies(tx, userId, { name: i.name, ...(mudaTelefone ? { phone: i.phone } : {}) })
  })
}

const senhaSchema = z.object({ current: z.string().max(200, 'A senha pode ter no máximo 200 caracteres.').optional(), next: passwordSchema })

const senhaErrada = (): DomainError =>
  new DomainError('forbidden', 'A senha atual não confere. Confira a senha e tente de novo.', {
    reason: 'wrong_password',
    fields: { current: 'Senha incorreta.' },
  })

/**
 * Cria ou troca a senha. Com senha: exige a atual (5 tentativas a cada 15 minutos por pessoa; acertar zera) e uma nova
 * diferente. Sem senha (só Google): cria a primeira, sem a atual. Nos dois casos derruba as outras sessões (a do token
 * passado fica) e apaga os links de redefinição vivos.
 */
export async function setPersonPassword(
  userId: string,
  input: { current?: string; next: string },
  keepSessionToken: string,
  now: Date,
): Promise<void> {
  const i = parse(senhaSchema, input)
  const pessoa = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!pessoa) throw new DomainError('not_found', 'Conta não encontrada.')
  const esperado = pessoa.passwordHash
  let chave: string | null = null
  if (esperado !== null) {
    const atual = i.current ?? ''
    if (atual === '') throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields: { current: 'Informe a senha atual.' } })
    if (atual === i.next) {
      throw new DomainError('validation', 'Confira os campos informados e tente de novo.', {
        fields: { next: 'A senha nova precisa ser diferente da atual.' },
      })
    }
    chave = limitKey('senha-pessoa', userId)
    const tentativa = await hitRateLimit(chave, LIMITS.loginEmail, now)
    if (!tentativa.allowed) throw new AuthError('rate_limited', tentativa.retryAfterSec)
    if (!(await verifyPassword(esperado, atual))) throw senhaErrada()
  } else {
    // Mesmo trabalho do caminho com senha, para o tempo não revelar o estado da conta.
    await verifyPassword(await fakePasswordHash, '')
  }
  const passwordHash = await hashPassword(i.next)
  const gravada = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, userId)
    // Condicional à senha conferida: outra troca ou redefinição no meio do caminho conta como "senha atual que não confere".
    const r = await tx.user.updateMany({ where: { id: userId, passwordHash: esperado }, data: { passwordHash } })
    if (r.count !== 1) return false
    await tx.userToken.deleteMany({ where: { userId, purpose: 'PASSWORD_RESET', usedAt: null } })
    await revokeUserAccess(tx, userId, now, keepSessionToken)
    return true
  })
  if (!gravada) throw senhaErrada()
  if (chave !== null) await clearRateLimit(chave)
}

const emailField = emailSchema.refine(isSafeRecipient, 'Informe um e-mail válido, por exemplo nome@exemplo.com.')
const emailInput = z.object({ email: emailField })
const confirmInput = z.object({ email: emailField, code: z.string().trim().regex(/^\d{6}$/, 'Informe o código de 6 dígitos que enviamos por e-mail.') })

/** Regra 9 do lado de quem só tem Google: não pode ir para um e-mail diferente do Google sem senha (ficaria trancada). */
function conferirSenhaParaTrocar(p: { passwordHash: string | null; googleEmail: string | null }, email: string): void {
  if (p.passwordHash === null && p.googleEmail !== null && emailChangeUnlinksGoogle({ email: p.googleEmail }, email)) {
    throw precisaDeSenha(SENHA_ANTES_DO_EMAIL)
  }
}

/**
 * Pede a troca de e-mail. Duas partes: esta função só valida e confere o que é da própria pessoa (e-mail igual, senha
 * necessária) e DEVOLVE a continuação (limites, código, envio ao e-mail NOVO), que a ação agenda para depois da resposta.
 * Se o e-mail novo já é de outra conta, isso só aparece na confirmação (quem não prova o e-mail não descobre nada).
 */
export async function requestEmailChange(userId: string, input: { email: string }, now: Date): Promise<() => Promise<void>> {
  const i = parse(emailInput, input)
  const pessoa = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, passwordHash: true, googleEmail: true } })
  if (!pessoa) throw new DomainError('not_found', 'Conta não encontrada.')
  if (i.email === pessoa.email) {
    throw new DomainError('validation', 'Este já é o seu e-mail.', { fields: { email: 'Este já é o seu e-mail.' } })
  }
  conferirSenhaParaTrocar(pessoa, i.email)
  return async () => {
    if (!(await allowCodeRequest('EMAIL_CHANGE', userId, i.email, now))) return
    const code = await issueEmailCode({ purpose: 'EMAIL_CHANGE', subject: userId, email: i.email, payload: {}, now })
    if (code === null) return
    await deliverAccessMail(
      'email_change_code',
      i.email,
      renderEmailChangeCode({ name: 'Agenda Flui', color: '#0B6E66' }, { name: pessoa.name, code, ttlMin: CODE_TTL_MINUTES }),
    )
  }
}

const emailTaken = (): DomainError =>
  new DomainError('conflict', 'Este e-mail já tem conta no Agenda Flui.', {
    reason: 'email_taken',
    fields: { email: 'Este e-mail já tem conta no Agenda Flui.' },
  })

const customerEmailTaken = (): DomainError =>
  new DomainError('conflict', 'Este e-mail já está no cadastro de outro cliente numa loja sua. Fale com a loja.', {
    reason: 'customer_email_taken',
    fields: { email: 'Este e-mail já está no cadastro de outro cliente numa loja sua. Fale com a loja.' },
  })

type Confirmacao = { googleUnlinked: boolean; calendarSealed: string | null } | { guessed: boolean }

/**
 * Confirma a troca com o código enviado ao e-mail novo. Sob `lockUserAccess`: confere o código, repete as checagens
 * (senha necessária, e-mail de outra pessoa, cliente de balcão com o e-mail numa loja dela), grava o e-mail verificado e as
 * cópias em `customers` juntos e, se o Google vinculado usa outro e-mail, desvincula o Google. Tudo ou nada.
 */
export async function confirmEmailChange(
  userId: string,
  input: { email: string; code: string },
  now: Date,
): Promise<{ googleUnlinked: boolean }> {
  const i = parse(confirmInput, input)
  await assertCodeGuessesLeft(userId, i.email, now)
  const tentar = (): Promise<Confirmacao> =>
    prisma.$transaction(async (tx) => {
      await lockUserAccess(tx, userId)
      const ok = await confirmEmailCode(tx, { purpose: 'EMAIL_CHANGE', subject: userId, email: i.email, code: i.code, now })
      if (!ok.ok) return { guessed: ok.guessed }
      const pessoa = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (i.email === pessoa.email) throw new DomainError('validation', 'Este já é o seu e-mail.', { fields: { email: 'Este já é o seu e-mail.' } })
      conferirSenhaParaTrocar(pessoa, i.email)
      const dono = await tx.user.findUnique({ where: { email: i.email }, select: { id: true } })
      if (dono && dono.id !== userId) throw emailTaken()
      const lojas = await tx.customer.findMany({ where: { userId }, select: { businessId: true } })
      if (lojas.length > 0) {
        const balcao = await tx.customer.findFirst({
          where: { businessId: { in: lojas.map((l) => l.businessId) }, email: i.email, userId: null },
          select: { id: true },
        })
        if (balcao) throw customerEmailTaken()
      }
      const desvincula = emailChangeUnlinksGoogle(
        pessoa.googleSub !== null && pessoa.googleEmail !== null ? { email: pessoa.googleEmail } : null,
        i.email,
      )
      const agora = toIsoInstant(now)
      // Um UPDATE só: e-mail, verificação e (se for o caso) os três campos do Google saem juntos (CHECKs da tabela).
      if (desvincula) {
        await tx.$executeRaw`
          UPDATE users SET email = ${i.email}, email_verified_at = ${agora}::timestamptz, google_sub = NULL, google_email = NULL,
            google_linked_at = NULL, updated_at = ${agora}::timestamptz WHERE id = ${userId}::uuid`
      } else {
        await tx.$executeRaw`
          UPDATE users SET email = ${i.email}, email_verified_at = ${agora}::timestamptz, updated_at = ${agora}::timestamptz
          WHERE id = ${userId}::uuid`
      }
      await syncCustomerCopies(tx, userId, { email: i.email })
      // Sem Google vinculado não há agenda: a ligação sai na mesma transação.
      return { googleUnlinked: desvincula, calendarSealed: desvincula ? await disconnectCalendarIn(tx, userId) : null }
    })

  let resultado: Confirmacao
  try {
    resultado = await tentar()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    // Alguém criou ou trocou para o mesmo e-mail agora mesmo: relê tudo uma vez e o erro certo sai das checagens.
    try {
      resultado = await tentar()
    } catch (err2) {
      if (isUniqueViolation(err2)) throw emailTaken()
      throw err2
    }
  }
  if ('guessed' in resultado) {
    if (resultado.guessed) await countCodeFailure(userId, i.email, now)
    throw invalidCode()
  }
  await clearCodeFailures(userId, i.email)
  revokeSealedLater(userId, resultado.calendarSealed)
  return { googleUnlinked: resultado.googleUnlinked }
}

/** Regra 7: desvincula o Google só de quem tem senha; sem senha, a pessoa criaria um acesso perdido. */
export async function unlinkGoogle(userId: string, now: Date): Promise<void> {
  const selo = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, userId)
    const pessoa = await tx.user.findUnique({ where: { id: userId }, select: { googleSub: true, passwordHash: true } })
    if (!pessoa || pessoa.googleSub === null) throw new DomainError('not_found', 'Nenhum Google vinculado.')
    if (pessoa.passwordHash === null) throw precisaDeSenha(SENHA_PRIMEIRO)
    // Condicional: a senha continua lá no instante da gravação.
    const agora = toIsoInstant(now)
    const r = await tx.$executeRaw`
      UPDATE users SET google_sub = NULL, google_email = NULL, google_linked_at = NULL, updated_at = ${agora}::timestamptz
      WHERE id = ${userId}::uuid AND google_sub IS NOT NULL AND password_hash IS NOT NULL`
    if (r !== 1) throw precisaDeSenha(SENHA_PRIMEIRO)
    // Desvincular também desliga o Google Agenda, na mesma transação.
    return disconnectCalendarIn(tx, userId)
  })
  revokeSealedLater(userId, selo)
}

/** Troca a loja atual da sessão. Só vale para loja em que a pessoa é cliente (ativo, conta ativa). */
export async function switchStore(sessionToken: string, userId: string, businessId: string): Promise<{ slug: string }> {
  const cliente = /^[0-9a-f-]{36}$/i.test(businessId)
    ? await prisma.customer.findFirst({
        where: { userId, businessId, archivedAt: null, anonymizedAt: null, business: { status: 'ACTIVE' } },
        select: { business: { select: { slug: true } } },
      })
    : null
  if (!cliente) throw new DomainError('not_found', 'Escolha uma das suas lojas.')
  await setSessionStore(sessionToken, businessId)
  return { slug: cliente.business.slug }
}
