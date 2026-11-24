import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { assertPlatformAdmin, requireActiveAdmin } from '@/server/auth/platform-actor'
import { lastFour, sealSecret } from '@/server/auth/secret-box'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import type { PlatformSetting, Prisma } from '@/server/db/generated/client'
import { auditPlatform } from '@/server/domain/audit'
import { DomainError, isUniqueViolation, parse, z } from '@/server/domain/errors'

/*
 * Chaves do "Entrar com Google" (Sistema > Google do painel dev): ID do cliente e chave secreta. A chave é cifrada aqui
 * (`secret-box.ts`, AAD `platform:google:client_secret`) e nunca volta: a tela recebe só a situação, os 4 últimos
 * caracteres e a URL de retorno. Quem lê em texto é `google-secrets.ts`, só para `src/server/auth/google/**`. A tabela tem
 * uma linha só (`id = 1`); sem linha vale versão 0. Toda gravação confere a versão e audita só os nomes dos campos.
 */

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export const GOOGLE_SECRET_AAD = 'platform:google:client_secret'

export type GoogleSettingsView = {
  configured: boolean
  clientId: string | null
  secretLast4: string | null
  updatedAt: Date | null
  redirectUrl: string
  version: number
}

const MSG_ID = 'Cole o ID do cliente do Google (termina em .apps.googleusercontent.com).'
const MSG_SEGREDO = 'Cole a chave secreta do cliente do Google.'
const MSG_CONFLITO = 'Outra pessoa alterou as chaves do Google enquanto você editava. Recarregue a página e refaça a alteração.'

const clientId = z.string(MSG_ID).trim().regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, MSG_ID)
const clientSecret = z.string(MSG_SEGREDO).trim().min(10, MSG_SEGREDO).max(200, MSG_SEGREDO).regex(/^\S+$/, MSG_SEGREDO)
const inputSchema = z.strictObject({ clientId, clientSecret: clientSecret.nullish() })

const conflito = (): DomainError => new DomainError('conflict', MSG_CONFLITO, { reason: 'stale_version' })

function visao(row: PlatformSetting | null): GoogleSettingsView {
  return {
    configured: row !== null && row.googleClientId !== null && row.googleClientSecretEnc !== null,
    clientId: row?.googleClientId ?? null,
    secretLast4: row?.googleClientSecretLast4 ?? null,
    updatedAt: row?.googleUpdatedAt ?? null,
    redirectUrl: areaLink('app', '/google/retorno'),
    version: row?.version ?? 0,
  }
}

type Plano = { data: Prisma.PlatformSettingUncheckedUpdateInput; action: string; fields: string[] }

/** Corpo comum de toda gravação: admin ativo relido, versão conferida, linha gravada e auditoria na mesma transação. */
async function gravar(actor: PlatformAdminActor, version: number, mudar: (atual: PlatformSetting | null) => Plano | null): Promise<GoogleSettingsView> {
  assertPlatformAdmin(actor)
  const v = parse(z.number().int().min(0), version)
  try {
    const row = await prisma.$transaction(async (tx) => {
      await requireActiveAdmin(tx, actor)
      const atual = await tx.platformSetting.findUnique({ where: { id: 1 } })
      if ((atual?.version ?? 0) !== v) throw conflito()
      const plano = mudar(atual)
      if (plano === null) return atual
      let depois: PlatformSetting
      if (atual === null) {
        depois = await tx.platformSetting.create({ data: { ...plano.data, id: 1 } as Prisma.PlatformSettingUncheckedCreateInput })
      } else {
        const r = await tx.platformSetting.updateMany({ where: { id: 1, version: v }, data: { ...plano.data, version: { increment: 1 } } })
        if (r.count === 0) throw conflito()
        depois = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } })
      }
      await auditPlatform(tx, actor, {
        businessId: null,
        action: plano.action,
        targetType: 'platform_settings',
        targetId: '1',
        metadata: { fields: plano.fields },
      })
      return depois
    })
    return visao(row)
  } catch (err) {
    if (isUniqueViolation(err)) throw conflito()
    throw err
  }
}

/** A situação das chaves, sem segredo. */
export async function getGoogleSettings(actor: PlatformAdminActor): Promise<GoogleSettingsView> {
  assertPlatformAdmin(actor)
  return visao(await prisma.platformSetting.findUnique({ where: { id: 1 } }))
}

/**
 * Grava o ID do cliente e, se vier, a chave secreta (`null` ou ausente mantém a atual). A primeira gravação exige a chave.
 */
export async function saveGoogleSettings(
  actor: PlatformAdminActor,
  input: { clientId: string; clientSecret?: string | null },
  version: number,
  now: Date,
): Promise<GoogleSettingsView> {
  assertPlatformAdmin(actor)
  const i = parse(inputSchema, { clientId: input.clientId, clientSecret: input.clientSecret === '' ? null : input.clientSecret })
  return gravar(actor, version, (atual) => {
    const novoSegredo = i.clientSecret ?? null
    if (novoSegredo === null && atual?.googleClientSecretEnc == null) {
      throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields: { clientSecret: MSG_SEGREDO } })
    }
    const data: Prisma.PlatformSettingUncheckedUpdateInput = { googleClientId: i.clientId, googleUpdatedAt: now }
    const fields = ['clientId']
    if (novoSegredo !== null) {
      data.googleClientSecretEnc = sealSecret(novoSegredo, GOOGLE_SECRET_AAD)
      data.googleClientSecretLast4 = lastFour(novoSegredo)
      fields.push('clientSecret')
    }
    return { data, action: 'platform.google_updated', fields }
  })
}

/** Remove as chaves: o botão "Continuar com Google" some de todas as telas. */
export async function clearGoogleSettings(actor: PlatformAdminActor, version: number, now: Date): Promise<GoogleSettingsView> {
  void now
  return gravar(actor, version, (atual) => {
    if (atual === null || atual.googleClientId === null) return null
    return {
      data: { googleClientId: null, googleClientSecretEnc: null, googleClientSecretLast4: null, googleUpdatedAt: null },
      action: 'platform.google_cleared',
      fields: ['clientId', 'clientSecret'],
    }
  })
}

/** Há chaves gravadas? Sem ator e sem abrir o selo: as telas de entrada usam para mostrar ou esconder o botão. */
export async function isGoogleConfigured(): Promise<boolean> {
  const row = await prisma.platformSetting.findUnique({ where: { id: 1 }, select: { googleClientId: true, googleClientSecretEnc: true } })
  return row !== null && row.googleClientId !== null && row.googleClientSecretEnc !== null
}
