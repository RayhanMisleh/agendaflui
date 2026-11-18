import 'server-only'
import { openSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'
import { SECRET_AAD } from './integrations'

/*
 * LEITURA dos segredos de integração em texto puro. Sem ator: quem chama é o domínio da loja (pagamento e frete), que
 * precisa do token para falar com o provedor. Por isso só `src/server/domain/store/**` e `src/server/domain/platform/**`
 * podem importar este arquivo (o teste `integration-secrets-imports.test.ts` varre `src/`). O texto puro nunca sai
 * daqui para tela, API, log, auditoria ou erro. Selo que não abre (outra conta, adulterado, outra chave) vira `null` e o
 * log traz só o nome do erro.
 */

function registrarFalha(onde: string, err: unknown): void {
  console.error(JSON.stringify({ level: 'error', event: 'integration_secret_unreadable', where: onde, error: err instanceof Error ? err.name : 'unknown' }))
}

type LinhaMp = { businessId: string; mpAccessTokenEnc: string | null; mpWebhookSecretEnc: string | null }

function abrirMp(row: LinhaMp, onde: string): { accessToken: string; webhookSecret: string } | null {
  if (row.mpAccessTokenEnc === null || row.mpWebhookSecretEnc === null) return null
  try {
    return {
      accessToken: openSecret(row.mpAccessTokenEnc, SECRET_AAD.mpAccessToken(row.businessId)),
      webhookSecret: openSecret(row.mpWebhookSecretEnc, SECRET_AAD.mpWebhookSecret(row.businessId)),
    }
  } catch (err) {
    registrarFalha(onde, err)
    return null
  }
}

/** Token e assinatura do Mercado Pago da conta; `null` se não estão configurados ou se não abrem. */
export async function readMercadoPagoSecrets(businessId: string): Promise<{ accessToken: string; webhookSecret: string } | null> {
  const row = await prisma.businessIntegration.findUnique({
    where: { businessId },
    select: { businessId: true, mpAccessTokenEnc: true, mpWebhookSecretEnc: true },
  })
  return row === null ? null : abrirMp(row, 'mercadopago')
}

/** Acha a conta pela chave do endereço do webhook e devolve os segredos dela; chave desconhecida ou selo ruim: `null`. */
export async function findMercadoPagoByWebhookKey(
  webhookKey: string,
): Promise<{ businessId: string; accessToken: string; webhookSecret: string } | null> {
  if (webhookKey === '') return null
  const row = await prisma.businessIntegration.findUnique({
    where: { mpWebhookKey: webhookKey },
    select: { businessId: true, mpAccessTokenEnc: true, mpWebhookSecretEnc: true },
  })
  if (row === null) return null
  const segredos = abrirMp(row, 'mercadopago_webhook')
  return segredos === null ? null : { businessId: row.businessId, ...segredos }
}

/** A chave opaca do endereço do webhook da conta (não é segredo de assinatura, mas faz parte do endereço); `null` sem configuração. */
export async function readMercadoPagoWebhookKey(businessId: string): Promise<string | null> {
  const row = await prisma.businessIntegration.findUnique({ where: { businessId }, select: { mpWebhookKey: true } })
  return row?.mpWebhookKey ?? null
}

export async function readFrenetToken(businessId: string): Promise<string | null> {
  const row = await prisma.businessIntegration.findUnique({ where: { businessId }, select: { frenetTokenEnc: true } })
  if (row === null || row.frenetTokenEnc === null) return null
  try {
    return openSecret(row.frenetTokenEnc, SECRET_AAD.frenetToken(businessId))
  } catch (err) {
    registrarFalha('frenet', err)
    return null
  }
}

/** Só se há credencial gravada (sem abrir nada): para a tela dizer "falta configurar" sem tocar no segredo. */
export async function integrationStatus(businessId: string): Promise<{ mercadoPago: boolean; frenet: boolean }> {
  const row = await prisma.businessIntegration.findUnique({
    where: { businessId },
    select: { mpAccessTokenEnc: true, mpWebhookSecretEnc: true, frenetTokenEnc: true },
  })
  return { mercadoPago: row !== null && row.mpAccessTokenEnc !== null && row.mpWebhookSecretEnc !== null, frenet: row?.frenetTokenEnc != null }
}
