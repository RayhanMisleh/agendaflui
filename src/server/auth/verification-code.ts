import 'server-only'
import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/server/db/client'
import type { Prisma, VerificationPurpose } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { isUniqueViolation } from '@/server/domain/errors'
import { env } from '@/server/env'
import { addMinutes, fromEpochMs } from '@/server/time'

export const CODE_TTL_MINUTES = 15
export const MAX_CODE_ATTEMPTS = 5

let chave: Buffer | undefined

/** Chave do HMAC dos códigos: derivada do APP_SECRET por HKDF com rótulo próprio, calculada uma vez. */
function codeKey(): Buffer {
  chave ??= Buffer.from(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/verification-code/v1', 32))
  return chave
}

/** Código de 6 dígitos (com zeros à esquerda), sorteado com fonte criptográfica. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * HMAC-SHA256 em hexadecimal sobre conta, propósito, e-mail e código. A conta, o propósito e o e-mail entram na
 * mensagem: um código de uma conta ou de um e-mail não vale em outro.
 */
export function codeMac(businessId: string, purpose: VerificationPurpose, email: string, code: string): string {
  return createHmac('sha256', codeKey()).update(JSON.stringify([businessId, purpose, email, code])).digest('hex')
}

function sameMac(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

type Issue = { businessId: string; purpose: VerificationPurpose; email: string; payload: Prisma.InputJsonObject; now: Date }
type Db = { $transaction: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T> }

/** Consome o código vivo (se houver) e cria o novo, na transação do chamador. */
async function issueCodeIn(tx: TenantTx, i: Issue): Promise<string> {
  const code = generateCode()
  await tx.verificationCode.updateMany({
    where: { purpose: i.purpose, email: i.email, consumedAt: null },
    data: { consumedAt: i.now, payload: {} },
  })
  await tx.verificationCode.create({
    data: {
      businessId: i.businessId,
      purpose: i.purpose,
      email: i.email,
      codeHash: codeMac(i.businessId, i.purpose, i.email, code),
      payload: i.payload,
      expiresAt: addMinutes(i.now, CODE_TTL_MINUTES),
    },
  })
  return code
}

/**
 * Emite um código vivo para (conta, propósito, e-mail) numa transação própria; "pedir de novo substitui": o vivo
 * é consumido antes de criar o novo. Dois pedidos simultâneos: o perdedor do índice único tenta de novo uma vez;
 * perdendo de novo, devolve `null` (outro pedido acabou de emitir um código vivo; não é erro).
 */
export async function issueCodeWithRetry(db: Db, i: Issue): Promise<string | null> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      return await db.$transaction((tx) => issueCodeIn(tx, i))
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  }
  return null
}

/**
 * Confere o código sob a transação do chamador. Devolve o `payload` e consome o código, ou `ok: false` (inexistente,
 * vencido, errado ou morto por tentativas; `guessed` diz se um palpite foi comparado com um código vivo). Tudo é UPDATE condicional: duas confirmações simultâneas do mesmo código
 * passam em exatamente uma, e a 5ª tentativa errada mata o código mesmo em paralelo. O chamador NÃO deve lançar
 * quando recebe `ok: false` (as tentativas contadas precisam ser confirmadas); lance só depois do commit.
 */
export async function confirmCode(
  tx: TenantTx,
  i: { businessId: string; purpose: VerificationPurpose; email: string; code: string; now: Date },
): Promise<{ ok: true; payload: Prisma.JsonValue } | { ok: false; guessed: boolean }> {
  const row = await tx.verificationCode.findFirst({
    where: { purpose: i.purpose, email: i.email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  const given = codeMac(i.businessId, i.purpose, i.email, i.code)
  // Sem linha, compara com um valor fixo para o trabalho ser o mesmo; a comparação é em tempo constante.
  const matches = sameMac(row?.codeHash ?? '0'.repeat(64), given) && row !== null
  if (!row) return { ok: false, guessed: false }
  if (row.expiresAt.getTime() <= i.now.getTime()) {
    await tx.verificationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: i.now, payload: {} } })
    return { ok: false, guessed: false }
  }
  if (matches) {
    const consumed = await tx.verificationCode.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS }, expiresAt: { gt: i.now } },
      data: { consumedAt: i.now, payload: {} },
    })
    return consumed.count === 1 ? { ok: true, payload: row.payload } : { ok: false, guessed: false }
  }
  // Errado: conta a tentativa de forma condicional (nunca passa do teto) e mata o código na última.
  const counted = await tx.verificationCode.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  })
  if (counted.count === 1) {
    // A linha fica travada por este UPDATE até o fim da transação: a releitura vê a contagem exata.
    const atual = await tx.verificationCode.findFirst({ where: { id: row.id }, select: { attempts: true } })
    if (atual && atual.attempts >= MAX_CODE_ATTEMPTS) {
      await tx.verificationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: i.now, payload: {} } })
    }
  }
  return { ok: false, guessed: true }
}

/** Apaga os códigos que venceram há mais de 1 dia (consumidos ou não); devolve quantos. Chamada pelo trabalho periódico. */
export async function purgeVerificationCodes(now: Date): Promise<number> {
  const corte = fromEpochMs(now.getTime() - 24 * 60 * 60 * 1000)
  const r = await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: corte } } })
  return r.count
}
