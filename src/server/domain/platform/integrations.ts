import 'server-only'
import { randomBytes } from 'node:crypto'
import type { Actor } from '@/server/auth/actor'
import { assertPlatformAdmin, requireActiveAdmin } from '@/server/auth/platform-actor'
import { lastFour, sealSecret } from '@/server/auth/secret-box'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import type { BusinessIntegration, Prisma } from '@/server/db/generated/client'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'
import { formatDateTime } from '@/server/time'

/*
 * Integrações da conta (aba Integrações do painel dev): Mercado Pago e Frenet. O admin digita os segredos, que são
 * cifrados aqui (AES-256-GCM, `secret-box.ts`) e nunca voltam: a tela recebe só a situação e os 4 últimos caracteres.
 * Quem lê os segredos em texto é `integration-secrets.ts`, só para o domínio da loja. Toda gravação confere a versão e
 * grava a auditoria na mesma transação, sem valor nem final.
 */

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type IntegrationsView = {
  /** 0 enquanto a conta não tem linha; a primeira gravação exige 0. */
  version: number
  mercadoPago: {
    configured: boolean
    accessTokenLast4: string | null
    webhookSecretLast4: string | null
    webhookUrl: string | null
    updatedLabel: string | null
  }
  frenet: { configured: boolean; tokenLast4: string | null; updatedLabel: string | null }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Os horários do painel dev são os de Brasília (a tela avisa). */
const FUSO_DA_PLATAFORMA = 'America/Sao_Paulo'

const MSG_CONFLITO = 'Outra pessoa alterou as integrações desta conta enquanto você editava. Recarregue a página e refaça a alteração.'
const MSG_TOKEN_MP = 'Use o token de acesso do Mercado Pago, que começa com APP_USR- ou TEST-.'
const MSG_SEGREDO_MP = 'Use a assinatura secreta do webhook: de 16 a 200 letras e números, sem espaços nem sinais.'
const MSG_TOKEN_FRENET = 'Use o token da Frenet: de 16 a 200 letras, números e hífens, sem espaços.'

// Os esquemas recusam o formato sem repetir o valor na mensagem. Espaços nas pontas saem antes da conferência.
const tokenMp = z.string(MSG_TOKEN_MP).trim().regex(/^(APP_USR|TEST)-[0-9A-Za-z-]{20,250}$/, MSG_TOKEN_MP)
const segredoMp = z.string(MSG_SEGREDO_MP).trim().regex(/^[0-9A-Za-z]{16,200}$/, MSG_SEGREDO_MP)
const tokenFrenet = z.string(MSG_TOKEN_FRENET).trim().regex(/^[0-9A-Za-z-]{16,200}$/, MSG_TOKEN_FRENET)

const mpSchema = z.strictObject({ accessToken: tokenMp.optional(), webhookSecret: segredoMp.optional() })
const frenetSchema = z.strictObject({ token: tokenFrenet })

/** `aad` de cada campo: conta + provedor + campo. Quem lê usa os mesmos (`integration-secrets.ts`). */
export const SECRET_AAD = {
  mpAccessToken: (businessId: string): string => `${businessId}:mercadopago:access_token`,
  mpWebhookSecret: (businessId: string): string => `${businessId}:mercadopago:webhook_secret`,
  frenetToken: (businessId: string): string => `${businessId}:frenet:token`,
} as const

function idDaConta(id: string): string {
  if (!UUID.test(id)) throw new DomainError('not_found', 'Conta não encontrada.')
  return id
}

function versaoLida(version: number): number {
  return parse(z.number().int().min(0), version)
}

const conflito = (): DomainError => new DomainError('conflict', MSG_CONFLITO, { reason: 'stale_version' })

function rotulo(instante: Date | null): string | null {
  return instante === null ? null : formatDateTime(instante, FUSO_DA_PLATAFORMA)
}

function visao(row: BusinessIntegration | null): IntegrationsView {
  const mpConfigurado = row !== null && row.mpAccessTokenEnc !== null && row.mpWebhookSecretEnc !== null
  return {
    version: row?.version ?? 0,
    mercadoPago: {
      configured: mpConfigurado,
      accessTokenLast4: row?.mpAccessTokenLast4 ?? null,
      webhookSecretLast4: row?.mpWebhookSecretLast4 ?? null,
      webhookUrl: mpConfigurado && row.mpWebhookKey !== null ? areaLink('api', `/v1/webhooks/mercadopago/${row.mpWebhookKey}`) : null,
      updatedLabel: row !== null && mpConfigurado ? rotulo(row.mpUpdatedAt) : null,
    },
    frenet: {
      configured: row !== null && row.frenetTokenEnc !== null,
      tokenLast4: row?.frenetTokenLast4 ?? null,
      updatedLabel: row !== null && row.frenetTokenEnc !== null ? rotulo(row.frenetUpdatedAt) : null,
    },
  }
}

async function auditar(tx: Prisma.TransactionClient, actor: PlatformAdminActor, action: string, businessId: string, fields: string[]): Promise<void> {
  // Só os NOMES dos campos que mudaram: nunca valor, nem final.
  await tx.auditLog.create({
    data: {
      businessId,
      actorType: 'PLATFORM_ADMIN',
      actorId: actor.adminId,
      actorName: actor.name,
      onBehalf: false,
      action,
      targetType: 'business',
      targetId: businessId,
      metadata: { fields },
    },
  })
}

/**
 * Corpo comum de toda gravação: confere o admin e a conta, lê a linha e a versão, deixa `mudar` devolver os dados novos
 * (ou `null` para "nada a gravar") e grava com a versão condicionada. Violação de unicidade (duas criações em paralelo)
 * vira o mesmo conflito de versão.
 */
async function gravar(
  actor: PlatformAdminActor,
  businessId: string,
  version: number,
  mudar: (row: BusinessIntegration | null) => { data: Prisma.BusinessIntegrationUncheckedUpdateInput; action: string; fields: string[] } | null,
): Promise<IntegrationsView> {
  assertPlatformAdmin(actor)
  idDaConta(businessId)
  const v = versaoLida(version)
  try {
    const row = await prisma.$transaction(async (tx) => {
      await requireActiveAdmin(tx, actor)
      if (!(await tx.business.findUnique({ where: { id: businessId }, select: { id: true } }))) {
        throw new DomainError('not_found', 'Conta não encontrada.')
      }
      const atual = await tx.businessIntegration.findUnique({ where: { businessId } })
      if ((atual?.version ?? 0) !== v) throw conflito()
      const plano = mudar(atual)
      if (plano === null) return atual
      let depois: BusinessIntegration
      if (atual === null) {
        depois = await tx.businessIntegration.create({ data: { ...plano.data, businessId } as Prisma.BusinessIntegrationUncheckedCreateInput })
      } else {
        const r = await tx.businessIntegration.updateMany({ where: { businessId, version: v }, data: { ...plano.data, version: { increment: 1 } } })
        if (r.count === 0) throw conflito()
        depois = await tx.businessIntegration.findUniqueOrThrow({ where: { businessId } })
      }
      await auditar(tx, actor, plano.action, businessId, plano.fields)
      return depois
    })
    return visao(row)
  } catch (err) {
    if (isUniqueViolation(err)) throw conflito()
    throw err
  }
}

/** A situação das integrações da conta, sem segredo: só se está configurada e os 4 últimos caracteres. */
export async function getIntegrations(actor: PlatformAdminActor, businessId: string): Promise<IntegrationsView> {
  assertPlatformAdmin(actor)
  idDaConta(businessId)
  if (!(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }))) {
    throw new DomainError('not_found', 'Conta não encontrada.')
  }
  return visao(await prisma.businessIntegration.findUnique({ where: { businessId } }))
}

/**
 * Grava o token e/ou a assinatura secreta do Mercado Pago. O Mercado Pago só fica configurado com os dois: o primeiro
 * `setMercadoPago` exige os dois, os seguintes aceitam trocar um só. A chave do endereço do webhook nasce aqui, na
 * primeira vez, e só muda depois de `clearMercadoPago`.
 */
export async function setMercadoPago(
  actor: PlatformAdminActor,
  businessId: string,
  version: number,
  input: { accessToken?: string; webhookSecret?: string },
  now: Date = new Date(),
): Promise<IntegrationsView> {
  assertPlatformAdmin(actor)
  idDaConta(businessId)
  const i = parse(mpSchema, input)
  if (i.accessToken === undefined && i.webhookSecret === undefined) {
    throw new DomainError('validation', 'Informe o token de acesso, a assinatura secreta do webhook ou os dois.', {
      fields: { accessToken: 'Informe o token de acesso.', webhookSecret: 'Informe a assinatura secreta do webhook.' },
    })
  }
  return gravar(actor, businessId, version, (atual) => {
    const falta: Record<string, string> = {}
    if (i.accessToken === undefined && atual?.mpAccessTokenEnc == null) falta.accessToken = 'Informe o token de acesso: na primeira vez os dois campos são necessários.'
    if (i.webhookSecret === undefined && atual?.mpWebhookSecretEnc == null) falta.webhookSecret = 'Informe a assinatura secreta do webhook: na primeira vez os dois campos são necessários.'
    if (Object.keys(falta).length > 0) throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields: falta })
    const data: Prisma.BusinessIntegrationUncheckedUpdateInput = { mpUpdatedAt: now }
    const fields: string[] = []
    if (i.accessToken !== undefined) {
      data.mpAccessTokenEnc = sealSecret(i.accessToken, SECRET_AAD.mpAccessToken(businessId))
      data.mpAccessTokenLast4 = lastFour(i.accessToken)
      fields.push('accessToken')
    }
    if (i.webhookSecret !== undefined) {
      data.mpWebhookSecretEnc = sealSecret(i.webhookSecret, SECRET_AAD.mpWebhookSecret(businessId))
      data.mpWebhookSecretLast4 = lastFour(i.webhookSecret)
      fields.push('webhookSecret')
    }
    if (atual?.mpWebhookKey == null) data.mpWebhookKey = randomBytes(32).toString('base64url')
    return { data, action: 'integration.mercadopago.updated', fields }
  })
}

/** Remove os segredos do Mercado Pago e a chave do webhook: a próxima configuração cria outra URL. */
export async function clearMercadoPago(actor: PlatformAdminActor, businessId: string, version: number): Promise<IntegrationsView> {
  return gravar(actor, businessId, version, (atual) => {
    if (atual === null || (atual.mpAccessTokenEnc === null && atual.mpWebhookSecretEnc === null && atual.mpWebhookKey === null)) return null
    return {
      data: {
        mpAccessTokenEnc: null,
        mpAccessTokenLast4: null,
        mpWebhookSecretEnc: null,
        mpWebhookSecretLast4: null,
        mpWebhookKey: null,
        mpUpdatedAt: null,
      },
      action: 'integration.mercadopago.cleared',
      fields: ['accessToken', 'webhookSecret'],
    }
  })
}

export async function setFrenet(
  actor: PlatformAdminActor,
  businessId: string,
  version: number,
  input: { token: string },
  now: Date = new Date(),
): Promise<IntegrationsView> {
  assertPlatformAdmin(actor)
  idDaConta(businessId)
  const i = parse(frenetSchema, input)
  return gravar(actor, businessId, version, () => ({
    data: { frenetTokenEnc: sealSecret(i.token, SECRET_AAD.frenetToken(businessId)), frenetTokenLast4: lastFour(i.token), frenetUpdatedAt: now },
    action: 'integration.frenet.updated',
    fields: ['token'],
  }))
}

export async function clearFrenet(actor: PlatformAdminActor, businessId: string, version: number): Promise<IntegrationsView> {
  return gravar(actor, businessId, version, (atual) => {
    if (atual === null || atual.frenetTokenEnc === null) return null
    return {
      data: { frenetTokenEnc: null, frenetTokenLast4: null, frenetUpdatedAt: null },
      action: 'integration.frenet.cleared',
      fields: ['token'],
    }
  })
}
