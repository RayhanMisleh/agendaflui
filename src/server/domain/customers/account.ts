import type { TenantContext } from '@/server/auth/actor'
import { AuthError } from '@/server/auth/actor'
import { issueTokens, revokeAllFor, type RequestMeta, type TokenPair } from '@/server/auth/api-tokens'
import { checkLoginLimit, clearLoginLimit } from '@/server/auth/login-limit'
import { hashPassword, passwordSchema, verifyPassword } from '@/server/auth/password'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from '@/server/auth/rate-limit-db'
import { CODE_TTL_MINUTES, confirmCode, issueCodeWithRetry } from '@/server/auth/verification-code'
import { tenantDb } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { normalizeEmail, normalizePhone, searchKey } from '@/server/domain/customers/contact'
import { DomainError, parse, z } from '@/server/domain/errors'
import { getEmailChannel } from '@/server/notifications/channels'
import { isSafeRecipient, maskEmail } from '@/server/notifications/channels/types'
import {
  renderAccountExists,
  renderPasswordResetCode,
  renderRegistrationCode,
  type AccountBrand,
  type RenderedMail,
} from '@/server/notifications/render-account'

export type { RequestMeta } from '@/server/auth/api-tokens'

export type CustomerSummary = { id: string; name: string; email: string }
export type CustomerSession = { customerId: string; pair: TokenPair; customer: CustomerSummary }

// Hash fixo para igualar o tempo quando não há senha para conferir.
const hashFalso = hashPassword('senha-falsa-para-igualar-o-tempo')

const EMAIL_MESSAGE = 'Informe um e-mail válido, por exemplo nome@exemplo.com.'

/** E-mail normalizado e simples (um único endereço, sem vírgula nem aspas); mensagem em pt-BR no erro. */
const emailField = z
  .string()
  .max(254, 'Use até 254 caracteres.')
  .transform((valor, ctx) => {
    try {
      const email = normalizeEmail(valor)
      if (isSafeRecipient(email)) return email
    } catch {
      // cai no erro abaixo
    }
    ctx.issues.push({ code: 'custom', message: EMAIL_MESSAGE, input: valor })
    return z.NEVER
  })

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
      ctx.issues.push({ code: 'custom', message: err instanceof RangeError ? err.message : 'Telefone inválido.', input: valor })
      return z.NEVER
    }
  })

const codeField = z.string().trim().regex(/^\d{6}$/, 'Informe o código de 6 dígitos que enviamos por e-mail.')
const currentPasswordField = z.string().min(1, 'Informe a senha.').max(200, 'A senha pode ter no máximo 200 caracteres.')

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome.').max(120, 'Use até 120 caracteres.'),
  email: emailField,
  phone: phoneField,
  password: passwordSchema,
})
const verifySchema = z.object({ email: emailField, code: codeField })
const resetSchema = z.object({ email: emailField, code: codeField, password: passwordSchema })
const changeSchema = z.object({ current: currentPasswordField, next: passwordSchema })
const deleteSchema = z.object({ password: currentPasswordField })

/** O que o cadastro guarda até a confirmação: nunca a senha, só o hash dela. */
const registerPayload = z.object({ name: z.string(), phone: z.string().nullable(), passwordHash: z.string() })

const invalidCode = (): DomainError =>
  new DomainError('validation', 'O código está incorreto ou venceu. Confira o código ou peça um novo.', {
    reason: 'invalid_code',
    fields: { code: 'Código incorreto ou vencido.' },
  })

const emailInUse = (): DomainError =>
  new DomainError('conflict', 'Este e-mail já tem uma conta. Entre com a sua senha ou recupere a senha.', {
    reason: 'email_taken',
    fields: { email: 'Este e-mail já tem uma conta.' },
  })

const wrongPassword = (): DomainError =>
  new DomainError('forbidden', 'A senha informada não confere. Confira a senha e tente de novo.', {
    reason: 'wrong_password',
    fields: { password: 'Senha incorreta.' },
  })

const invalidCredentials = (): AuthError => new AuthError('invalid_credentials')

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002'
}

async function brandOf(businessId: string): Promise<AccountBrand> {
  const branding = await tenantDb(businessId).businessBranding.findFirst({ select: { displayName: true, primaryColor: true } })
  return { name: branding?.displayName ?? 'AgendaFlui', color: branding?.primaryColor ?? '#0E4F5C' }
}

/**
 * Envia um e-mail de conta na hora, pelo canal do ambiente. Falha ou ausência de canal não muda a resposta da rota:
 * vai para o log só com o tipo, o e-mail mascarado e o nome do erro (nunca o código, o endereço inteiro nem a mensagem).
 */
async function deliver(businessId: string, kind: string, to: string, render: (brand: AccountBrand) => RenderedMail): Promise<void> {
  const channel = getEmailChannel()
  if (!channel) {
    console.warn(JSON.stringify({ level: 'warn', event: 'account_mail_skipped', kind, to: maskEmail(to) }))
    return
  }
  try {
    const mail = render(await brandOf(businessId))
    await channel.send({ to, ...mail })
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', event: 'account_mail_failed', kind, to: maskEmail(to), error: err instanceof Error ? err.name : 'unknown' }),
    )
  }
}

/** Conta um pedido de código para o e-mail; `false` quando passou do limite (a rota responde igual e não envia). */
async function allowCodeRequest(businessId: string, purpose: 'REGISTER' | 'PASSWORD_RESET', email: string, now: Date): Promise<boolean> {
  const r = await hitRateLimit(limitKey(`codigo:${businessId}:${purpose}`, email), LIMITS.codeEmail, now)
  return r.allowed
}

/**
 * Pede o cadastro: NÃO cria o cliente. Guarda um código de confirmação (só o HMAC) com o nome, o telefone e o HASH da
 * senha, e envia o código por e-mail. Se o e-mail já tem conta com senha, responde igual e o e-mail avisa disso.
 * O hash da senha é calculado nos dois caminhos para o trabalho ser o mesmo.
 */
export async function requestRegistration(
  businessId: string,
  input: { name: string; email: string; phone?: string | null; password: string },
  _meta: RequestMeta,
  now: Date,
): Promise<void> {
  const i = parse(registerSchema, input)
  const passwordHash = await hashPassword(i.password)
  if (!(await allowCodeRequest(businessId, 'REGISTER', i.email, now))) return
  const db = tenantDb(businessId)
  const existing = await db.customer.findFirst({
    where: { email: i.email },
    select: { name: true, passwordHash: true, archivedAt: true, anonymizedAt: true },
  })
  if (existing) {
    // Cliente arquivado ou removido: a conta não está disponível; nada é enviado (a resposta continua igual).
    if (existing.passwordHash !== null && existing.archivedAt === null && existing.anonymizedAt === null) {
      await deliver(businessId, 'account_exists', i.email, (brand) => renderAccountExists(brand, { customerName: existing.name }))
    }
    if (existing.passwordHash !== null || existing.archivedAt !== null || existing.anonymizedAt !== null) return
  }
  const code = await issueCodeWithRetry(db, {
    businessId,
    purpose: 'REGISTER',
    email: i.email,
    payload: { name: i.name, phone: i.phone, passwordHash },
    now,
  })
  if (code === null) return
  await deliver(businessId, 'registration', i.email, (brand) =>
    renderRegistrationCode(brand, { customerName: i.name, code, ttlMin: CODE_TTL_MINUTES }),
  )
}

/**
 * Confirma o cadastro com o código: cria o cliente (origem APP, e-mail verificado) ou assume o cadastro de balcão com o
 * mesmo e-mail e sem senha (mantém nome, histórico e observações, grava a senha), e emite os tokens, tudo na mesma
 * transação. Código errado, vencido ou morto: `invalid_code`.
 */
export async function confirmRegistration(
  businessId: string,
  input: { email: string; code: string },
  meta: RequestMeta,
  now: Date,
): Promise<CustomerSession> {
  const i = parse(verifySchema, input)
  const db = tenantDb(businessId)
  const before = await db.customer.findFirst({ where: { email: i.email }, select: { id: true } })
  let session: CustomerSession | null
  try {
    session = await db.$transaction(async (tx) => {
      if (before) await tx.$lockKey('customer', before.id)
      const ok = await confirmCode(tx, { businessId, purpose: 'REGISTER', email: i.email, code: i.code, now })
      if (!ok) return null
      const payload = registerPayload.safeParse(ok.payload)
      if (!payload.success) throw new Error('O código de cadastro guardado está corrompido.')
      let current = await tx.customer.findFirst({ where: { email: i.email } })
      if (current && current.id !== before?.id) {
        // Um cadastro de balcão com este e-mail surgiu depois da primeira leitura: trava e relê.
        await tx.$lockKey('customer', current.id)
        current = await tx.customer.findFirst({ where: { id: current.id } })
      }
      if (current && (current.passwordHash !== null || current.archivedAt !== null || current.anonymizedAt !== null)) throw emailInUse()
      const customer = current
        ? await tx.customer.update({
            where: { id: current.id },
            data: {
              passwordHash: payload.data.passwordHash,
              emailVerifiedAt: now,
              ...(current.phone === null && payload.data.phone !== null ? { phone: payload.data.phone } : {}),
            },
          })
        : await tx.customer.create({
            data: {
              businessId,
              name: payload.data.name,
              searchName: searchKey(payload.data.name),
              email: i.email,
              phone: payload.data.phone,
              passwordHash: payload.data.passwordHash,
              emailVerifiedAt: now,
              origin: 'APP',
            },
          })
      const pair = await issueTokens(tx, { kind: 'customer', businessId, customerId: customer.id }, meta, now)
      return { customerId: customer.id, pair, customer: { id: customer.id, name: customer.name, email: i.email } }
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw emailInUse()
    throw err
  }
  if (!session) throw invalidCode()
  return session
}

/**
 * Entrada do cliente. Mesmo erro (`invalid_credentials`) para e-mail inexistente ou malformado, senha errada, cliente sem
 * senha, arquivado ou removido, sempre com uma verificação de senha para igualar o tempo.
 */
export async function loginCustomer(
  businessId: string,
  input: { email: string; password: string },
  meta: RequestMeta,
  now: Date,
): Promise<CustomerSession> {
  const raw = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const area = `app-cliente:${businessId}` as const
  await checkLoginLimit(area, raw, meta.ip ?? undefined, now)
  let email: string | null = null
  try {
    email = normalizeEmail(raw)
  } catch {
    // e-mail malformado: segue pelo caminho de credenciais inválidas
  }
  const db = tenantDb(businessId)
  const customer = email === null ? null : await db.customer.findFirst({ where: { email } })
  const ok = await verifyPassword(customer?.passwordHash ?? (await hashFalso), typeof input.password === 'string' ? input.password : '')
  if (!customer || !customer.passwordHash || !ok || customer.archivedAt !== null || customer.anonymizedAt !== null) {
    throw invalidCredentials()
  }
  const session = await db.$transaction(async (tx) => {
    await tx.$lockKey('customer', customer.id)
    // Relê sob a trava: arquivar ou remover a conta revoga tokens sob esta mesma trava.
    const atual = await tx.customer.findFirst({ where: { id: customer.id }, select: { archivedAt: true, anonymizedAt: true } })
    if (!atual || atual.archivedAt !== null || atual.anonymizedAt !== null) return null
    const pair = await issueTokens(tx, { kind: 'customer', businessId, customerId: customer.id }, meta, now)
    return { customerId: customer.id, pair, customer: { id: customer.id, name: customer.name, email: customer.email ?? '' } }
  })
  if (!session) throw invalidCredentials()
  await clearLoginLimit(area, raw, meta.ip ?? undefined)
  return session
}

/**
 * Esqueci a senha: sempre termina sem erro. Só envia o código se houver cliente ativo (com senha ou cadastro de balcão)
 * com aquele e-mail e o limite por e-mail permitir.
 */
export async function requestPasswordReset(businessId: string, email: string, _meta: RequestMeta, now: Date): Promise<void> {
  const parsed = emailField.safeParse(email)
  if (!parsed.success) return
  if (!(await allowCodeRequest(businessId, 'PASSWORD_RESET', parsed.data, now))) return
  const db = tenantDb(businessId)
  const customer = await db.customer.findFirst({
    where: { email: parsed.data, archivedAt: null, anonymizedAt: null },
    select: { id: true, name: true },
  })
  if (!customer) return
  const code = await issueCodeWithRetry(db, {
    businessId,
    purpose: 'PASSWORD_RESET',
    email: parsed.data,
    payload: { customerId: customer.id },
    now,
  })
  if (code === null) return
  await deliver(businessId, 'password_reset', parsed.data, (brand) =>
    renderPasswordResetCode(brand, { customerName: customer.name, code, ttlMin: CODE_TTL_MINUTES }),
  )
}

/** Redefine a senha com o código: troca a senha e revoga todos os tokens de renovação do cliente. */
export async function resetPassword(
  businessId: string,
  input: { email: string; code: string; password: string },
  _meta: RequestMeta,
  now: Date,
): Promise<void> {
  const i = parse(resetSchema, input)
  const passwordHash = await hashPassword(i.password)
  const db = tenantDb(businessId)
  const found = await db.customer.findFirst({ where: { email: i.email, archivedAt: null, anonymizedAt: null }, select: { id: true } })
  const done = await db.$transaction(async (tx) => {
    if (found) await tx.$lockKey('customer', found.id)
    const ok = await confirmCode(tx, { businessId, purpose: 'PASSWORD_RESET', email: i.email, code: i.code, now })
    if (!ok) return false
    const payload = z.object({ customerId: z.string() }).safeParse(ok.payload)
    if (!found || !payload.success || payload.data.customerId !== found.id) return false
    const customer = await tx.customer.findFirst({
      where: { id: found.id, archivedAt: null, anonymizedAt: null },
      select: { emailVerifiedAt: true },
    })
    if (!customer) return false
    await tx.customer.update({
      where: { id: found.id },
      data: { passwordHash, emailVerifiedAt: customer.emailVerifiedAt ?? now },
    })
    await revokeAllFor(tx, { customerId: found.id }, now)
    return true
  })
  if (!done) throw invalidCode()
}

/** Conta uma tentativa de senha do próprio cliente (troca e exclusão); o teto é o do login por e-mail. */
async function countPasswordTry(ctx: TenantContext, customerId: string): Promise<string> {
  const key = limitKey(`senha-confirma:${ctx.businessId}`, customerId)
  const r = await hitRateLimit(key, LIMITS.loginEmail, ctx.clock())
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
  return key
}

async function assertOwnPassword(ctx: TenantContext, customerId: string, password: string): Promise<void> {
  const key = await countPasswordTry(ctx, customerId)
  const row = await ctx.db.customer.findFirst({ where: { id: customerId }, select: { passwordHash: true, archivedAt: true, anonymizedAt: true } })
  const ok = await verifyPassword(row?.passwordHash ?? (await hashFalso), password)
  if (!row || !row.passwordHash || !ok || row.anonymizedAt !== null) throw wrongPassword()
  await clearRateLimit(key)
}

function ownCustomerId(ctx: TenantContext): string {
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Só o próprio cliente pode fazer isso.')
  return ctx.actor.customerId
}

/** O cliente troca a própria senha (confere a atual) e todos os tokens de renovação dele são revogados. */
export async function changePassword(ctx: TenantContext, input: { current: string; next: string }): Promise<void> {
  const customerId = ownCustomerId(ctx)
  const i = parse(changeSchema, input)
  await assertOwnPassword(ctx, customerId, i.current)
  const passwordHash = await hashPassword(i.next)
  const now = ctx.clock()
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', customerId)
    await tx.customer.update({ where: { id: customerId }, data: { passwordHash } })
    await revokeAllFor(tx, { customerId }, now)
    await audit(ctx, { action: 'customer.password_changed', targetType: 'Customer', targetId: customerId }, tx)
  })
}

/** O cliente exclui a própria conta, confirmando com a senha: anonimiza (e apaga tokens, dispositivos e códigos). */
export async function deleteOwnAccount(ctx: TenantContext, input: { password: string }): Promise<void> {
  const customerId = ownCustomerId(ctx)
  const i = parse(deleteSchema, input)
  await assertOwnPassword(ctx, customerId, i.password)
  await anonymizeCustomer(ctx, customerId)
}
