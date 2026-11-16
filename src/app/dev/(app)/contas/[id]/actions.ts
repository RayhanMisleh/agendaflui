'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { updateBusinessData, setBusinessStatus } from '@/server/domain/platform/businesses'
import type { BusinessStatus } from '@/server/domain/platform/businesses'
import { createApiKey, listApiKeys, revokeApiKey, updateApiKeyOrigins } from '@/server/domain/platform/api-keys'
import type { BrandImageSlot, BrandInput } from '@/server/domain/platform/customization'
import { setBrandImage, updateBrand, updateModules, updateNotificationsAsAdmin, updateRulesAsAdmin, updateTerms } from '@/server/domain/platform/customization'
import { changeMemberRole, listTeam, resendInvite, setMemberActive } from '@/server/domain/platform/team'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/server/domain/settings/notification-settings'
import type { NotificationSettings } from '@/server/domain/settings/notification-settings'
import type { SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { adminAction } from '../../_lib/action'
import type { PlatformAdminActor } from '../../_lib/action'
import type { FormState } from '../../_lib/form-state'
import { MSG_CONFLITO } from './forms'
import type { Campos } from './forms'

/*
 * Ações da página da conta. Cada formulário manda o `businessId` da conta que a página mostra; o alvo (chave, acesso da
 * equipe) é conferido contra essa conta antes de agir, então um formulário desta conta nunca mexe em item de outra.
 * Todas passam por `adminAction`: `requirePlatformAdmin()` roda em toda execução.
 */

/** Lê os campos nomeados como texto; caixa de marcar vira `'on'` ou `''`; arquivo e campo ausente viram `''`. */
function ler(fd: FormData, nomes: readonly string[], caixas: readonly string[] = []): Campos {
  const v: Campos = {}
  for (const n of nomes) {
    const x = fd.get(n)
    v[n] = typeof x === 'string' ? x : ''
  }
  for (const n of caixas) v[n] = fd.has(n) ? 'on' : ''
  return v
}

function atualizar(): void {
  revalidatePath('/dev/contas/[id]', 'layout')
}

/** Termina uma ação com sucesso: a página da conta recarrega e o estado diz o que foi feito, com os valores atuais. */
function feito(mensagem: string, extra: Campos = {}) {
  return (_r: unknown, v: Campos): FormState<Campos> => {
    atualizar()
    return { ok: true, message: mensagem, fields: {}, values: { ...v, ...extra } }
  }
}

/** Versão velha vira o aviso de conflito da tela, mantendo o código e o motivo do domínio. */
async function comVersao<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof DomainError && err.reason === 'stale_version') {
      throw new DomainError('conflict', MSG_CONFLITO, { reason: 'stale_version' })
    }
    throw err
  }
}

/** Troca o nome de campo do domínio pelo do formulário (também `campo.0`, `campo.1` das listas). */
function renomear(err: unknown, mapa: Record<string, string>): unknown {
  if (!(err instanceof DomainError) || !err.fields) return err
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [mapa[k.split('.')[0] ?? k] ?? k, m]))
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}) })
}

function erroDeCampo(campo: string, mensagem: string): DomainError {
  return new DomainError('validation', mensagem, { fields: { [campo]: mensagem } })
}

function naoVazio(v: Campos, campos: readonly string[]): void {
  for (const c of campos) {
    if ((v[c] ?? '').trim() === '') throw erroDeCampo(c, 'Informe um número.')
  }
}

function origens(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((o) => o.trim())
    .filter((o) => o !== '')
}

// ---------------------------------------------------------------- dados e situação

const DADOS = ['businessId', 'version', 'name', 'slug', 'legalName', 'document', 'contactEmail', 'contactPhone', 'internalNotes'] as const

/** Edita os dados cadastrais com a versão que a página leu; versão velha é conflito e o que foi digitado fica na tela. */
export const salvarDados = adminAction(
  (fd) => ler(fd, DADOS),
  async (admin, v) => {
    const { businessId, version, ...patch } = v
    return comVersao(updateBusinessData(admin, businessId ?? '', Number(version), patch))
  },
  (r, v) => feito('Dados salvos.', { version: String(r.version) })(r, v),
)

function situacao(to: BusinessStatus, mensagem: string) {
  return adminAction(
    (fd) => ler(fd, ['businessId', 'confirmName']),
    (admin, v) => setBusinessStatus(admin, v.businessId ?? '', to, { confirmName: v.confirmName ?? '' }),
    (r, v) => feito(mensagem)(r, { ...v, confirmName: '' }),
  )
}
export const suspenderConta = situacao('SUSPENDED', 'Conta suspensa.')
export const reativarConta = situacao('ACTIVE', 'Conta reativada.')
export const arquivarConta = situacao('ARCHIVED', 'Conta arquivada.')

// ---------------------------------------------------------------- marca

const MARCA = ['businessId', 'version', 'displayName', 'primary', 'accent', 'material', 'paper', 'fontPair', 'loginMessage'] as const

export const salvarMarca = adminAction(
  (fd) => ler(fd, MARCA),
  async (admin, v) => {
    const entrada = {
      displayName: v.displayName ?? '',
      primary: v.primary ?? '',
      accent: v.accent ?? '',
      material: v.material ?? '',
      paper: v.paper ?? '',
      fontPair: v.fontPair ?? '',
      loginMessage: (v.loginMessage ?? '').trim() === '' ? null : (v.loginMessage ?? ''),
    }
    // O domínio confere cada valor; o tipo só deixa de reclamar da lista de opções.
    return comVersao(updateBrand(admin, v.businessId ?? '', Number(v.version), entrada as BrandInput))
  },
  (r, v) => feito('Marca salva.', { version: String(r.version) })(r, v),
)

const SLOTS: readonly BrandImageSlot[] = ['logo', 'symbol', 'favicon', 'loginImage']

type TrocaDeImagem = { businessId: string; slot: string; intent: string; file: File | null }

/** Um slot de imagem por vez: envia (`intent=send`) ou remove (`intent=remove`). O erro do domínio volta no campo do slot. */
export const trocarImagem = adminAction<TrocaDeImagem, string>(
  (fd) => {
    const arquivo = fd.get('file')
    return {
      businessId: String(fd.get('businessId') ?? ''),
      slot: String(fd.get('slot') ?? ''),
      intent: String(fd.get('intent') ?? ''),
      file: arquivo instanceof File && arquivo.size > 0 ? arquivo : null,
    }
  },
  async (admin: PlatformAdminActor, v) => {
    const slot = SLOTS.find((s) => s === v.slot)
    if (!slot) throw erroDeCampo('slot', 'Escolha onde a imagem vai: logo, símbolo, favicon ou imagem de entrada.')
    if (v.intent === 'remove') {
      await setBrandImage(admin, v.businessId, slot, null)
      return 'Imagem removida.'
    }
    if (!v.file) throw erroDeCampo(slot, 'Escolha uma imagem para enviar.')
    await setBrandImage(admin, v.businessId, slot, { bytes: new Uint8Array(await v.file.arrayBuffer()), mime: v.file.type })
    return 'Imagem enviada.'
  },
  (mensagem, v) => {
    atualizar()
    return { ok: true, message: mensagem, fields: {}, values: { ...v, file: null } }
  },
)

// ---------------------------------------------------------------- termos, módulos, regras e avisos

const TERMOS = ['professionalSingular', 'professionalPlural', 'customerSingular', 'customerPlural', 'pointsSingular', 'pointsPlural', 'club'] as const

export const salvarTermos = adminAction(
  (fd) => ler(fd, ['businessId', ...TERMOS]),
  (admin, v) =>
    updateTerms(admin, v.businessId ?? '', {
      professionalSingular: v.professionalSingular ?? '',
      professionalPlural: v.professionalPlural ?? '',
      customerSingular: v.customerSingular ?? '',
      customerPlural: v.customerPlural ?? '',
      pointsSingular: v.pointsSingular ?? '',
      pointsPlural: v.pointsPlural ?? '',
      club: v.club ?? '',
    }),
  (r, v) => feito('Termos salvos.')(r, v),
)

export const salvarModulos = adminAction(
  (fd) => ler(fd, ['businessId'], ['loyalty', 'banners', 'store', 'vouchers']),
  (admin, v) =>
    updateModules(admin, v.businessId ?? '', { loyalty: v.loyalty === 'on', banners: v.banners === 'on', store: v.store === 'on', vouchers: v.vouchers === 'on' }),
  (r, v) => feito('Módulos salvos.')(r, v),
)

const NUMEROS_REGRAS = ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const

export const salvarRegras = adminAction(
  (fd) => ler(fd, ['businessId', 'timeZone', ...NUMEROS_REGRAS], ['autoConfirm']),
  (admin, v) => {
    naoVazio(v, NUMEROS_REGRAS)
    const regras: Partial<SchedulingRules> & { timeZone: string } = {
      slotStepMin: Number(v.slotStepMin),
      minLeadMin: Number(v.minLeadMin),
      maxAdvanceDays: Number(v.maxAdvanceDays),
      customerChangeWindowMin: Number(v.customerChangeWindowMin),
      bufferMin: Number(v.bufferMin),
      autoConfirm: v.autoConfirm === 'on',
      timeZone: v.timeZone ?? '',
    }
    return updateRulesAsAdmin(admin, v.businessId ?? '', regras)
  },
  (r, v) => feito('Regras e fuso salvos.')(r, v),
)

const TIPOS_DE_AVISO = Object.keys(DEFAULT_NOTIFICATION_SETTINGS)

/** Os avisos chegam como uma caixa por tipo e canal (`TIPO__email`, `TIPO__push`); caixa desmarcada desliga. */
export const salvarAvisos = adminAction(
  (fd) =>
    ler(
      fd,
      ['businessId'],
      TIPOS_DE_AVISO.flatMap((k) => [`${k}__email`, `${k}__push`]),
    ),
  (admin, v) => {
    const todos = Object.fromEntries(TIPOS_DE_AVISO.map((k) => [k, { email: v[`${k}__email`] === 'on', push: v[`${k}__push`] === 'on' }]))
    return updateNotificationsAsAdmin(admin, v.businessId ?? '', todos as NotificationSettings)
  },
  (r, v) => feito('Avisos salvos.')(r, v),
)

// ---------------------------------------------------------------- equipe

async function doMembro(admin: PlatformAdminActor, businessId: string, membershipId: string) {
  const membro = (await listTeam(admin, businessId)).find((m) => m.membershipId === membershipId)
  if (!membro) throw new DomainError('not_found', 'Acesso da equipe não encontrado nesta conta. Recarregue a página.')
  return membro
}

export const trocarPapel = adminAction(
  (fd) => ler(fd, ['businessId', 'membershipId', 'role']),
  async (admin, v) => {
    await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    // O domínio confere o papel; o tipo só deixa de reclamar da lista de opções.
    return changeMemberRole(admin, v.membershipId ?? '', (v.role ?? '') as Parameters<typeof changeMemberRole>[2])
  },
  (r, v) => feito('Papel trocado.')(r, v),
)

/** Desativar pede o nome da pessoa (ação que tira acesso); reativar não pede nada. */
export const alternarAcesso = adminAction(
  (fd) => ler(fd, ['businessId', 'membershipId', 'active', 'confirmName']),
  async (admin, v) => {
    const membro = await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    const ativar = v.active === 'true'
    if (!ativar && v.confirmName !== membro.name) {
      throw erroDeCampo('confirmName', 'Digite o nome da pessoa exatamente como aparece, para confirmar.')
    }
    return setMemberActive(admin, membro.membershipId, ativar)
  },
  (r, v) => feito(r.active ? 'Acesso reativado.' : 'Acesso desativado.')(r, { ...v, confirmName: '' }),
)

export const reenviarConvite = adminAction(
  (fd) => ler(fd, ['businessId', 'membershipId']),
  async (admin, v) => {
    const membro = await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    await resendInvite(admin, membro.membershipId)
  },
  (r, v) => feito('Convite reenviado.')(r, v),
)

// ---------------------------------------------------------------- chaves

async function daConta(admin: PlatformAdminActor, businessId: string, keyId: string) {
  const chave = (await listApiKeys(admin, { businessId })).find((k) => k.id === keyId)
  if (!chave) throw new DomainError('not_found', 'Chave não encontrada nesta conta. Recarregue a página.')
  return chave
}

/** Cria a chave da conta. O segredo volta só neste estado (`values.secret`) e nunca é gravado nem listado. */
export const criarChave = adminAction(
  (fd) => ler(fd, ['businessId', 'name', 'origins']),
  async (admin, v) => {
    try {
      return await createApiKey(admin, { kind: 'ACCOUNT', businessId: v.businessId ?? '', name: (v.name ?? '').trim(), allowedOrigins: origens(v.origins ?? '') })
    } catch (err) {
      throw renomear(err, { allowedOrigins: 'origins' })
    }
  },
  (r, v) => feito('Chave criada.', { secret: r.secret, keyName: r.key.name, name: '', origins: '' })(r, v),
)

export const revogarChave = adminAction(
  (fd) => ler(fd, ['businessId', 'keyId', 'confirmName']),
  async (admin, v) => {
    const chave = await daConta(admin, v.businessId ?? '', v.keyId ?? '')
    if (v.confirmName !== chave.name) throw erroDeCampo('confirmName', 'Digite o nome da chave exatamente como aparece, para confirmar.')
    await revokeApiKey(admin, chave.id)
  },
  (r, v) => feito('Chave revogada.')(r, { ...v, confirmName: '' }),
)

export const editarOrigens = adminAction(
  (fd) => ler(fd, ['businessId', 'keyId', 'origins']),
  async (admin, v) => {
    const chave = await daConta(admin, v.businessId ?? '', v.keyId ?? '')
    try {
      return await updateApiKeyOrigins(admin, chave.id, origens(v.origins ?? ''))
    } catch (err) {
      throw renomear(err, { allowedOrigins: 'origins' })
    }
  },
  (r, v) => feito('Origens salvas.')(r, v),
)
