import 'server-only'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import { normalizePhone, searchKey } from '@/server/domain/customers/contact'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { emailSchema, personNameSchema } from '@/server/domain/platform/schemas'
import { isSafeRecipient } from '@/server/notifications/channels/types'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { renderAccountExists, renderSignupCode, type AccountBrand } from '@/server/notifications/render-account'
import {
  allowCodeRequest,
  assertCodeGuessesLeft,
  CODE_TTL_MINUTES,
  confirmEmailCode,
  countCodeFailure,
  invalidCode,
  issueEmailCode,
} from './email-code'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { hashPassword, passwordSchema } from './password'
import { activatePerson, personState } from './person'
import { lockUserAccess } from './password-reset'
import { hitRateLimit, LIMITS, limitKey, type LimitRule } from './rate-limit-db'
import { loginWithPassword, openSession } from './session'
import { findOpenStore, joinStore, joinStoreIn, type JoinResult } from './store-join'
import type { RequestMeta } from './support-session'

/*
 * Cadastro e entrada do cliente pelo link da loja. O cadastro NÃO cria nada antes do código: guarda o HMAC do código de 6
 * dígitos com nome, telefone e o HASH da senha, e envia o código por e-mail. A confirmação cria a pessoa (ou ativa a conta
 * pendente com a senha escolhida), liga ao cliente da loja (cria ou adota o de balcão) e abre a sessão, tudo numa transação.
 * Conta ativa com o e-mail: nunca cria segunda conta ("Este e-mail já tem conta. Entre com ela.").
 */

/** Limite por origem (IP ou /64), antes de qualquer hash ou envio: o teto por e-mail sozinho não segura quem varia o e-mail. */
async function checkSignupIp(prefix: string, rule: LimitRule, ip: string | undefined, now: Date): Promise<void> {
  if (!ip) return
  const r = await hitRateLimit(limitKey(prefix, ipLimitKeyPart(ip)), rule, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}

export type StoreSession = { token: string; expiresAt: Date; userId: string; join: JoinResult }

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

const emailField = emailSchema.refine(isSafeRecipient, 'Informe um e-mail válido, por exemplo nome@exemplo.com.')
const codeField = z.string().trim().regex(/^\d{6}$/, 'Informe o código de 6 dígitos que enviamos por e-mail.')

const signupSchema = z.object({ name: personNameSchema, email: emailField, phone: phoneField, password: passwordSchema })
const verifySchema = z.object({ email: emailField, code: codeField })

/** O que o cadastro guarda até a confirmação: nunca a senha, só o hash dela. */
const payloadSchema = z.object({ name: z.string(), phone: z.string().nullable(), passwordHash: z.string() })

const emailTaken = (): DomainError =>
  new DomainError('conflict', 'Este e-mail já tem conta. Entre com ela.', {
    reason: 'email_taken',
    fields: { email: 'Este e-mail já tem conta. Entre com ela.' },
  })

const lojaFechada = (): DomainError => new DomainError('not_found', 'Esta loja não está disponível agora. Confira o link com a loja.')

async function brandOf(businessId: string): Promise<AccountBrand> {
  const b = await prisma.businessBranding.findUnique({ where: { businessId }, select: { displayName: true, primaryColor: true } })
  return { name: b?.displayName ?? 'Agenda Flui', color: b?.primaryColor ?? '#0B6E66' }
}

/**
 * Pede o cadastro. Duas partes, para o tempo da resposta não revelar se o e-mail existe: esta função faz só o que é igual
 * para todos (valida, confere a loja e faz o hash da senha, sempre) e DEVOLVE a continuação, que a ação agenda para depois
 * da resposta (`runAfterResponse`): limites por e-mail, consulta da pessoa, emissão do código e envio.
 */
export async function requestStoreSignup(
  slug: string,
  input: { name: string; email: string; phone?: string | null; password: string },
  meta: RequestMeta,
  now: Date,
): Promise<() => Promise<void>> {
  await checkSignupIp('cadastro-loja:ip', LIMITS.panelResetIp, meta.ip, now)
  const i = parse(signupSchema, input)
  const loja = await findOpenStore(slug)
  if (!loja) throw lojaFechada()
  const passwordHash = await hashPassword(i.password)
  return async () => {
    if (!(await allowCodeRequest('SIGNUP', loja.businessId, i.email, now))) return
    const pessoa = await prisma.user.findUnique({ where: { email: i.email }, select: { name: true, passwordHash: true, googleSub: true } })
    const brand = await brandOf(loja.businessId)
    if (pessoa && personState(pessoa) === 'active') {
      await deliverAccessMail('account_exists', i.email, renderAccountExists(brand, { name: pessoa.name, loginUrl: areaLink('app', `/${loja.slug}/entrar`) }))
      return
    }
    const code = await issueEmailCode({
      purpose: 'SIGNUP',
      subject: loja.businessId,
      email: i.email,
      payload: { name: i.name, phone: i.phone, passwordHash },
      now,
    })
    if (code === null) return
    await deliverAccessMail('signup_code', i.email, renderSignupCode(brand, { name: i.name, code, ttlMin: CODE_TTL_MINUTES }))
  }
}

type Confirmacao = StoreSession | { guessed: boolean }

/**
 * Confirma o cadastro com o código. Numa transação: trava a pessoa (se existe), confere o código, cria a pessoa ou ativa a
 * pendente, liga ao cliente da loja e abre a sessão. Código errado, vencido ou morto: `invalid_code`. Dois cadastros do
 * mesmo e-mail ao mesmo tempo: o perdedor do índice único repete e então recebe "conta existente".
 */
export async function confirmStoreSignup(
  slug: string,
  input: { email: string; code: string },
  meta: RequestMeta,
  now: Date,
): Promise<StoreSession> {
  await checkSignupIp('cadastro-loja-confirma:ip', LIMITS.authIp, meta.ip, now)
  const i = parse(verifySchema, input)
  const loja = await findOpenStore(slug)
  if (!loja) throw lojaFechada()
  await assertCodeGuessesLeft(loja.businessId, i.email, now)

  const tentar = (): Promise<Confirmacao> =>
    prisma.$transaction(async (tx) => {
      let pessoa = await tx.user.findUnique({ where: { email: i.email } })
      if (pessoa) await lockUserAccess(tx, pessoa.id)
      const ok = await confirmEmailCode(tx, { purpose: 'SIGNUP', subject: loja.businessId, email: i.email, code: i.code, now })
      if (!ok.ok) return { guessed: ok.guessed }
      const payload = payloadSchema.safeParse(ok.payload)
      if (!payload.success) throw new Error('O código de cadastro guardado está corrompido.')
      // Releitura sob a trava: a pessoa pode ter surgido entre a primeira leitura e a confirmação.
      if (!pessoa) {
        pessoa = await tx.user.findUnique({ where: { email: i.email } })
        if (pessoa) await lockUserAccess(tx, pessoa.id)
      }
      if (pessoa) pessoa = await tx.user.findUniqueOrThrow({ where: { id: pessoa.id } })
      let userId: string
      if (!pessoa) {
        const nova = await tx.user.create({
          data: {
            name: payload.data.name,
            searchName: searchKey(payload.data.name),
            email: i.email,
            phone: payload.data.phone,
            passwordHash: payload.data.passwordHash,
            emailVerifiedAt: now,
          },
          select: { id: true },
        })
        userId = nova.id
      } else if (personState(pessoa) === 'pending') {
        await activatePerson(tx, pessoa.id, { passwordHash: payload.data.passwordHash }, now)
        // O nome digitado vale; o telefone só preenche se estava vazio.
        await tx.user.update({
          where: { id: pessoa.id },
          data: { name: payload.data.name, searchName: searchKey(payload.data.name), ...(pessoa.phone === null && payload.data.phone !== null ? { phone: payload.data.phone } : {}) },
        })
        userId = pessoa.id
      } else {
        throw emailTaken()
      }
      const join = await joinStoreIn(tx, userId, loja.businessId, now)
      const sessao = await openSession(tx, {
        userId,
        now,
        customerBusinessId: loja.businessId,
        ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
        ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
        ...(meta.previousToken !== undefined ? { previousToken: meta.previousToken } : {}),
      })
      return { ...sessao, userId, join }
    })

  let resultado: Confirmacao
  try {
    resultado = await tentar()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    // Outro cadastro do mesmo e-mail (ou do mesmo cliente) venceu a corrida: relê tudo uma vez.
    try {
      resultado = await tentar()
    } catch (err2) {
      if (isUniqueViolation(err2)) throw emailTaken()
      throw err2
    }
  }
  if ('guessed' in resultado) {
    if (resultado.guessed) await countCodeFailure(loja.businessId, i.email, now)
    throw invalidCode()
  }
  return resultado
}

/** Entrada pela loja: e-mail e senha da pessoa; a sessão já nasce com a loja como última usada e a pessoa vira cliente dela. */
export async function signInAtStore(
  slug: string,
  input: { email: string; password: string },
  meta: RequestMeta,
  now: Date,
): Promise<StoreSession> {
  const loja = await findOpenStore(slug)
  if (!loja) throw lojaFechada()
  const entrada = await loginWithPassword(
    {
      email: typeof input.email === 'string' ? input.email : '',
      password: typeof input.password === 'string' ? input.password : '',
      customerBusinessId: loja.businessId,
      ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
      ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
      ...(meta.previousToken !== undefined ? { previousToken: meta.previousToken } : {}),
    },
    now,
  )
  const join = await joinStore(entrada.userId, loja.businessId, now)
  return { ...entrada, join }
}
