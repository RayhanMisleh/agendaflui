'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { updateBusinessData, setBusinessStatus } from '@/server/domain/platform/businesses'
import type { BusinessStatus } from '@/server/domain/platform/businesses'
import type { BrandInput } from '@/server/domain/platform/customization'
import { getCustomization, updateBrand, updateModules, updateNotificationsAsAdmin, updateRulesAsAdmin, updateTerms } from '@/server/domain/platform/customization'
import { changeMemberRole, inviteMember, listTeam, resendInvite, setMemberActive } from '@/server/domain/platform/team'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/server/domain/settings/notification-settings'
import type { NotificationSettings } from '@/server/domain/settings/notification-settings'
import type { SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { adminAction } from '../../_lib/action'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import type { PlatformAdminActor } from '../../_lib/action'
import type { FormState } from '@/app/_lib/form-state'
import { MSG_CONFLITO } from './forms'
import type { Campos } from './forms'

/*
 * Ações da página da conta. O primeiro argumento de toda ação é o id da conta, ligado pela página (`acao.bind(null, id)`).
 * Os argumentos ligados trafegam pelo cliente (a referência da ação leva o id junto): eles não são segredo nem prova de
 * nada. A garantia real é o guarda de admin (`requirePlatformAdmin()` em toda execução, por `adminAction`) e a conferência
 * do alvo contra a conta: o item que o formulário escolhe (acesso da equipe) precisa existir NESTA conta, então um
 * formulário nunca mexe em item de outra.
 */

function atualizar(): void {
  revalidatePath('/dev/contas/[id]', 'layout')
}

/** Termina uma ação com sucesso: a página da conta recarrega e o estado diz o que foi feito, com os valores atuais. */
function feitoNaConta(mensagem: string, v: Campos, extra: Campos = {}): FormState<Campos> {
  atualizar()
  return feito(mensagem, v, extra)
}

type Entrada = { nomes: readonly string[]; caixas?: readonly string[] }

/** Monta uma ação da conta: `(businessId, estado anterior, formulário)`. O id ligado vale sempre; o formulário não o escolhe. */
function porConta<R>(
  entrada: Entrada,
  run: (admin: PlatformAdminActor, v: Campos) => Promise<R>,
  done: (r: R, v: Campos) => FormState<Campos>,
) {
  return async (businessId: string, prev: FormState<Campos>, fd: FormData): Promise<FormState<Campos>> =>
    adminAction((f) => ({ ...ler(f, entrada.nomes, entrada.caixas), businessId }), run, done)(prev, fd)
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

function naoVazio(v: Campos, campos: readonly string[]): void {
  for (const c of campos) {
    if ((v[c] ?? '').trim() === '') throw erroDeCampo(c, 'Informe um número.')
  }
}

// ---------------------------------------------------------------- dados e situação

const DADOS = ['version', 'name', 'slug', 'document', 'contactEmail', 'contactPhone'] as const

/** Edita os dados cadastrais com a versão que a página leu; versão velha é conflito e o que foi digitado fica na tela. */
export const salvarDados = porConta(
  { nomes: DADOS },
  async (admin, v) => {
    const { businessId, version, ...patch } = v
    return comVersao(updateBusinessData(admin, businessId ?? '', Number(version), patch))
  },
  (r, v) => feitoNaConta('Dados salvos.', v, { version: String(r.version) }),
)

function situacao(to: BusinessStatus, mensagem: string) {
  return porConta(
    { nomes: ['confirmName'] },
    (admin, v) => setBusinessStatus(admin, v.businessId ?? '', to, { confirmName: v.confirmName ?? '' }),
    (r, v) => feitoNaConta(mensagem, { ...v, confirmName: '' }),
  )
}
export const suspenderConta = situacao('SUSPENDED', 'Conta suspensa.')
export const reativarConta = situacao('ACTIVE', 'Conta reativada.')
export const arquivarConta = situacao('ARCHIVED', 'Conta arquivada.')

// ---------------------------------------------------------------- marca

const MARCA = ['version', 'displayName', 'primary', 'accent', 'material'] as const

export const salvarMarca = porConta(
  { nomes: MARCA },
  async (admin, v) => {
    const entrada = {
      displayName: v.displayName ?? '',
      primary: v.primary ?? '',
      accent: v.accent ?? '',
      material: v.material ?? '',
    }
    // O domínio confere cada valor; o tipo só deixa de reclamar da lista de opções.
    return comVersao(updateBrand(admin, v.businessId ?? '', Number(v.version), entrada as BrandInput))
  },
  (r, v) => feitoNaConta('Marca salva.', v, { version: String(r.version) }),
)

// ---------------------------------------------------------------- termos, módulos, regras e avisos

const TERMOS = ['professionalSingular', 'professionalPlural', 'customerSingular', 'customerPlural', 'pointsSingular', 'pointsPlural', 'club'] as const

/**
 * Termos, regras e avisos moram na mesma linha (`business_settings`) que o dono também edita: o formulário leva a versão lida
 * pela tela, e quem grava sobre uma versão antiga recebe o aviso de conflito. Depois de gravar, a versão atual volta no estado.
 */
async function versaoDasConfiguracoes(admin: PlatformAdminActor, businessId: string): Promise<number> {
  return (await getCustomization(admin, businessId)).rules.version
}

export const salvarTermos = porConta(
  { nomes: ['version', ...TERMOS] },
  async (admin, v) => {
    const businessId = v.businessId ?? ''
    await comVersao(
      updateTerms(
        admin,
        businessId,
        {
          professionalSingular: v.professionalSingular ?? '',
          professionalPlural: v.professionalPlural ?? '',
          customerSingular: v.customerSingular ?? '',
          customerPlural: v.customerPlural ?? '',
          pointsSingular: v.pointsSingular ?? '',
          pointsPlural: v.pointsPlural ?? '',
          club: v.club ?? '',
        },
        Number(v.version),
      ),
    )
    return versaoDasConfiguracoes(admin, businessId)
  },
  (r, v) => feitoNaConta('Termos salvos.', v, { version: String(r) }),
)

export const salvarModulos = porConta(
  { nomes: [], caixas: ['loyalty', 'banners', 'store', 'vouchers'] },
  (admin, v) =>
    updateModules(admin, v.businessId ?? '', { loyalty: v.loyalty === 'on', banners: v.banners === 'on', store: v.store === 'on', vouchers: v.vouchers === 'on' }),
  (r, v) => feitoNaConta('Módulos salvos.', v),
)

const NUMEROS_REGRAS = ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const

export const salvarRegras = porConta(
  { nomes: ['version', ...NUMEROS_REGRAS], caixas: ['autoConfirm'] },
  async (admin, v) => {
    naoVazio(v, NUMEROS_REGRAS)
    const regras: Partial<SchedulingRules> = {
      slotStepMin: Number(v.slotStepMin),
      minLeadMin: Number(v.minLeadMin),
      maxAdvanceDays: Number(v.maxAdvanceDays),
      customerChangeWindowMin: Number(v.customerChangeWindowMin),
      bufferMin: Number(v.bufferMin),
      autoConfirm: v.autoConfirm === 'on',
    }
    return comVersao(updateRulesAsAdmin(admin, v.businessId ?? '', regras, Number(v.version)))
  },
  (r, v) => feitoNaConta('Regras salvas.', v, { version: String(r.rules.version) }),
)

const TIPOS_DE_AVISO = Object.keys(DEFAULT_NOTIFICATION_SETTINGS)

/** Os avisos chegam como uma caixa por tipo e canal (`TIPO__email`, `TIPO__push`); caixa desmarcada desliga. */
export const salvarAvisos = porConta(
  { nomes: ['version'], caixas: TIPOS_DE_AVISO.flatMap((k) => [`${k}__email`, `${k}__push`]) },
  async (admin, v) => {
    const todos = Object.fromEntries(TIPOS_DE_AVISO.map((k) => [k, { email: v[`${k}__email`] === 'on', push: v[`${k}__push`] === 'on' }]))
    const businessId = v.businessId ?? ''
    await comVersao(updateNotificationsAsAdmin(admin, businessId, todos as NotificationSettings, Number(v.version)))
    return versaoDasConfiguracoes(admin, businessId)
  },
  (r, v) => feitoNaConta('Avisos salvos.', v, { version: String(r) }),
)

// ---------------------------------------------------------------- equipe

async function doMembro(admin: PlatformAdminActor, businessId: string, membershipId: string) {
  const membro = (await listTeam(admin, businessId)).find((m) => m.membershipId === membershipId)
  if (!membro) throw new DomainError('not_found', 'Acesso da equipe não encontrado nesta conta. Recarregue a página.')
  return membro
}

/** Convida uma pessoa nova para a equipe. As mensagens do domínio (e-mail já vinculado, conta arquivada) voltam no estado. */
export const convidarMembro = porConta(
  { nomes: ['name', 'email', 'role'] },
  (admin, v) =>
    // O domínio confere nome, e-mail e papel; o tipo só deixa de reclamar da lista de opções.
    inviteMember(admin, v.businessId ?? '', { name: v.name ?? '', email: v.email ?? '', role: (v.role ?? '') as Parameters<typeof inviteMember>[2]['role'] }),
  (r, v) => feitoNaConta('Convite enviado. A pessoa já aparece na equipe.', v, { name: '', email: '' }),
)

export const trocarPapel = porConta(
  { nomes: ['membershipId', 'role'] },
  async (admin, v) => {
    await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    // O domínio confere o papel; o tipo só deixa de reclamar da lista de opções.
    return changeMemberRole(admin, v.membershipId ?? '', (v.role ?? '') as Parameters<typeof changeMemberRole>[2])
  },
  (r, v) => feitoNaConta('Papel trocado.', v),
)

/** Desativar pede o nome da pessoa (ação que tira acesso); reativar não pede nada. */
export const alternarAcesso = porConta(
  { nomes: ['membershipId', 'active', 'confirmName'] },
  async (admin, v) => {
    const membro = await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    const ativar = v.active === 'true'
    if (!ativar && v.confirmName !== membro.name) {
      throw erroDeCampo('confirmName', 'Digite o nome da pessoa exatamente como aparece, para confirmar.')
    }
    return setMemberActive(admin, membro.membershipId, ativar)
  },
  (r, v) => feitoNaConta(r.active ? 'Acesso reativado.' : 'Acesso desativado.', { ...v, confirmName: '' }),
)

export const reenviarConvite = porConta(
  { nomes: ['membershipId'] },
  async (admin, v) => {
    const membro = await doMembro(admin, v.businessId ?? '', v.membershipId ?? '')
    await resendInvite(admin, membro.membershipId)
  },
  (r, v) => feitoNaConta('Convite reenviado.', v),
)
