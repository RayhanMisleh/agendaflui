import type { TenantContext } from '@/server/auth/actor'
import type { BusinessSettings } from '@/server/db/generated/client'
import { auditIn } from '@/server/domain/audit'
import { authorize, parse, z } from '@/server/domain/errors'
import { writeSettings, type SettingsTx } from '@/server/domain/settings/versioned'

export type Terms = {
  professionalSingular: string
  professionalPlural: string
  customerSingular: string
  customerPlural: string
  pointsSingular: string
  pointsPlural: string
  club: string
}

export const MSG_MARCACAO = 'Não use os sinais < e >.'
export const MSG_CONTROLE = 'Não use caracteres de controle (como quebra de linha ou tabulação).'
// \p{C}: controle, formato (como o espaço de largura zero), surrogates soltos e não atribuídos.
// O U+200D (junção de emoji) vale: sem ele os emojis compostos (família, profissões) se quebram.
export const SEM_CONTROLE = (v: string) => !/[^\P{C}\u200D]/u.test(v)
export const SEM_MARCACAO = (v: string) => !/[<>]/.test(v)
// Na mensagem de entrada a quebra de linha vale; qualquer outro caractere de controle não.
export const SEM_CONTROLE_EXCETO_LINHA = (v: string) => !/[^\P{C}\r\n\u200D]/u.test(v)
// A junção só vale ENTRE dois caracteres de verdade (emoji composto): sozinha, no começo, no fim, repetida ou ao lado de
// espaço ela deixaria um texto "vazio" passar, ou um nome terminado em caractere invisível.
export const MSG_JUNCAO = 'Não deixe o caractere invisível de junção de emoji sozinho, no começo, no fim ou repetido.'
const JUNCAO_SOLTA = /(^|[\s\u200D])\u200D|\u200D($|[\s\u200D])/u
export const SEM_JUNCAO_SOLTA = (v: string) => !JUNCAO_SOLTA.test(v)

/** Nome de exibição da conta: o mesmo esquema para o painel dev (marca) e para o dono (dados do negócio). */
export const displayNameSchema = z
  .string('Informe o nome de exibição.')
  .trim()
  .min(1, 'Informe o nome de exibição.')
  .max(80, 'Use no máximo 80 caracteres.')
  .refine(SEM_MARCACAO, MSG_MARCACAO)
  .refine(SEM_CONTROLE, MSG_CONTROLE)
  .refine(SEM_JUNCAO_SOLTA, MSG_JUNCAO)

const termo = z
  .string('Informe o termo.')
  .trim()
  .min(1, 'Informe o termo.')
  .max(30, 'Use no máximo 30 caracteres.')
  .refine(SEM_MARCACAO, MSG_MARCACAO)
  .refine(SEM_CONTROLE, MSG_CONTROLE)
  .refine(SEM_JUNCAO_SOLTA, MSG_JUNCAO)

/** Os sete termos da conta; objeto com campo a mais é recusado. O dono e o painel dev usam este mesmo esquema. */
export const termsSchema = z.strictObject({
  professionalSingular: termo,
  professionalPlural: termo,
  customerSingular: termo,
  customerPlural: termo,
  pointsSingular: termo,
  pointsPlural: termo,
  club: termo,
})

export function termsOf(s: Pick<
  BusinessSettings,
  | 'termProfessionalSingular'
  | 'termProfessionalPlural'
  | 'termCustomerSingular'
  | 'termCustomerPlural'
  | 'termPointsSingular'
  | 'termPointsPlural'
  | 'termClub'
>): Terms {
  return {
    professionalSingular: s.termProfessionalSingular,
    professionalPlural: s.termProfessionalPlural,
    customerSingular: s.termCustomerSingular,
    customerPlural: s.termCustomerPlural,
    pointsSingular: s.termPointsSingular,
    pointsPlural: s.termPointsPlural,
    club: s.termClub,
  }
}

/**
 * Grava os termos dentro da transação `tx` (a do cliente da conta ou a do `prisma` cru do painel dev). Mesma gravação para o
 * dono e para o admin: UPDATE condicional pela versão quando ela é informada (`stale_version`), sem versão grava e sobe;
 * sem mudança não grava, não sobe e não audita. A auditoria guarda antes e depois só dos campos que mudaram.
 */
export async function applyTerms(
  ctx: TenantContext,
  tx: SettingsTx,
  input: Terms,
  version?: number,
): Promise<{ terms: Terms; version: number }> {
  authorize(ctx, 'manage_settings')
  const i = parse(termsSchema, input)
  let changes: Record<string, { from: string; to: string }> = {}
  const { row } = await writeSettings(tx, ctx, version, (atual) => {
    const antes = termsOf(atual)
    const campos = (Object.keys(i) as (keyof Terms)[]).filter((k) => i[k] !== antes[k])
    if (campos.length === 0) return null
    changes = Object.fromEntries(campos.map((k) => [k, { from: antes[k], to: i[k] }]))
    return {
      data: {
        termProfessionalSingular: i.professionalSingular,
        termProfessionalPlural: i.professionalPlural,
        termCustomerSingular: i.customerSingular,
        termCustomerPlural: i.customerPlural,
        termPointsSingular: i.pointsSingular,
        termPointsPlural: i.pointsPlural,
        termClub: i.club,
      },
    }
  })
  if (Object.keys(changes).length > 0) {
    await auditIn(tx, ctx, { action: 'terms.updated', targetType: 'business', targetId: ctx.businessId, metadata: { changes } })
  }
  return { terms: termsOf(row), version: row.version }
}

export async function updateTermsOf(ctx: TenantContext, input: Terms, version?: number): Promise<{ terms: Terms; version: number }> {
  authorize(ctx, 'manage_settings')
  return ctx.db.$transaction((tx) => applyTerms(ctx, tx, input, version))
}

export async function readTerms(ctx: TenantContext): Promise<{ terms: Terms; version: number }> {
  authorize(ctx, 'manage_settings')
  const row = await ctx.db.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId } })
  return { terms: termsOf(row), version: row.version }
}
