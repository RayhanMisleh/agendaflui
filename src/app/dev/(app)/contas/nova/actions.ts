'use server'
import { redirect, unstable_rethrow } from 'next/navigation'
import { createApiKey } from '@/server/domain/platform/api-keys'
import { createBusiness } from '@/server/domain/platform/businesses'
import { DomainError } from '@/server/domain/errors'
import { getCustomization, setBrandImage, updateBrand, updateModules, updateRulesAsAdmin, updateTerms } from '@/server/domain/platform/customization'
import { parseSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import type { SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { adminAction } from '../../_lib/action'
import type { PlatformAdminActor } from '../../_lib/action'
import type { FormState } from '../../_lib/form-state'
import { pickValues, readValues } from './fields'
import type { TermSet, WizardData, WizardResult, WizardValues } from './fields'

const COR = /^#[0-9a-fA-F]{6}$/
const SEM_MARCACAO = /[<>]/
const SEM_CONTROLE = /\p{C}/u

function vazio(valor: string): boolean {
  return valor.trim() === ''
}

/**
 * Confere, ANTES de criar a conta, os campos que só os passos seguintes validariam (marca, termos, módulos, regras, chave).
 * Assim um erro de digitação não deixa uma conta criada pela metade. As regras valem as do domínio, que valida de novo.
 */
function conferirAntes(v: WizardValues): Record<string, string> {
  const erros: Record<string, string> = {}
  const texto = (campo: string, valor: string, max: number, obrigatorio: boolean, nome: string) => {
    if (obrigatorio && vazio(valor)) erros[campo] = `Informe ${nome}.`
    else if (valor.trim().length > max) erros[campo] = `Use no máximo ${max} caracteres.`
    else if (SEM_MARCACAO.test(valor)) erros[campo] = 'Não use os sinais < e >.'
    else if (SEM_CONTROLE.test(campo === 'loginMessage' ? valor.replace(/[\r\n]/g, '') : valor)) erros[campo] = 'Não use caracteres de controle (como tabulação).'
  }
  texto('displayName', v.displayName, 80, true, 'o nome de exibição')
  if (!COR.test(v.primary)) erros.primary = 'Use uma cor no formato #rrggbb, com 6 dígitos.'
  if (!COR.test(v.accent)) erros.accent = 'Use uma cor no formato #rrggbb, com 6 dígitos.'
  texto('loginMessage', v.loginMessage, 280, false, 'a mensagem')
  const termos: Array<[keyof TermSet, string]> = [
    ['professionalSingular', 'o termo do profissional'],
    ['professionalPlural', 'o termo do profissional no plural'],
    ['customerSingular', 'o termo do cliente'],
    ['customerPlural', 'o termo do cliente no plural'],
    ['pointsSingular', 'o termo dos pontos'],
    ['pointsPlural', 'o termo dos pontos no plural'],
    ['club', 'o nome do clube'],
  ]
  for (const [campo, nome] of termos) texto(campo, v[campo], 30, true, nome)
  if (v.vouchers && !v.store) {
    erros.vouchers = 'Vouchers exigem a Loja ligada, porque são vendidos como produto. Ligue a Loja ou desligue Vouchers.'
  }
  try {
    parseSchedulingRules(regrasDe(v))
  } catch (e) {
    if (!(e instanceof DomainError)) throw e
    Object.assign(erros, e.fields ?? {})
  }
  if (v.createKey) texto('keyName', v.keyName, 80, true, 'o nome da chave')
  return erros
}

function numero(valor: string): number | undefined {
  return vazio(valor) ? undefined : Number(valor)
}

function regrasDe(v: WizardValues): Partial<SchedulingRules> {
  const regras: Partial<SchedulingRules> = { autoConfirm: v.autoConfirm }
  const campos = ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const
  for (const c of campos) {
    const n = numero(v[c])
    if (n !== undefined) regras[c] = n
  }
  return regras
}

/** Erros do domínio usam `owner.email`; o formulário chama de `ownerEmail`. */
function traduzir(err: unknown): unknown {
  if (!(err instanceof DomainError) || !err.fields) return err
  const mapa: Record<string, string> = { 'owner.name': 'ownerName', 'owner.email': 'ownerEmail' }
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [mapa[k] ?? k, m]))
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}) })
}

const FALTOU: Record<string, string> = {
  marca: 'A marca (cores, material, fontes)',
  logo: 'A logo',
  termos: 'Os termos',
  modulos: 'Os módulos',
  regras: 'As regras de agenda',
  chave: 'A chave de app',
}

type Passo = { codigo: keyof typeof FALTOU }

/** Roda um passo depois da criação. Erro esperado ou inesperado vira pendência; só o NOME do erro vai para o log. */
async function passo(falhas: Passo[], codigo: Passo['codigo'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    unstable_rethrow(err)
    if (!(err instanceof DomainError)) {
      console.error(JSON.stringify({ level: 'error', event: 'dev_create_account_step_failed', step: codigo, error: err instanceof Error ? err.name : 'unknown' }))
    }
    falhas.push({ codigo })
  }
}

async function executar(admin: PlatformAdminActor, v: WizardData): Promise<WizardResult & { faltou: string[] }> {
  const erros = conferirAntes(v)
  if (Object.keys(erros).length > 0) {
    throw new DomainError('validation', 'Confira os campos marcados e tente de novo.', { fields: erros })
  }

  let criada: Awaited<ReturnType<typeof createBusiness>>
  try {
    criada = await createBusiness(admin, {
      name: v.name,
      slug: v.slug,
      timeZone: v.timeZone,
      ...(vazio(v.legalName) ? {} : { legalName: v.legalName }),
      ...(vazio(v.document) ? {} : { document: v.document }),
      ...(vazio(v.contactEmail) ? {} : { contactEmail: v.contactEmail }),
      ...(vazio(v.contactPhone) ? {} : { contactPhone: v.contactPhone }),
      ...(vazio(v.internalNotes) ? {} : { internalNotes: v.internalNotes }),
      owner: { name: v.ownerName, email: v.ownerEmail },
    })
  } catch (err) {
    throw traduzir(err)
  }
  const id = criada.business.id
  const falhas: Passo[] = []

  await passo(falhas, 'marca', async () => {
    const atual = await getCustomization(admin, id)
    await updateBrand(admin, id, atual.brand.version, {
      displayName: v.displayName,
      primary: v.primary,
      accent: v.accent,
      material: v.material,
      paper: v.paper,
      fontPair: v.fontPair,
      loginMessage: vazio(v.loginMessage) ? null : v.loginMessage,
    })
  })
  if (v.logo) {
    const arquivo = v.logo
    await passo(falhas, 'logo', async () => {
      await setBrandImage(admin, id, 'logo', { bytes: new Uint8Array(await arquivo.arrayBuffer()), mime: arquivo.type })
    })
  }
  await passo(falhas, 'termos', async () => {
    await updateTerms(admin, id, {
      professionalSingular: v.professionalSingular,
      professionalPlural: v.professionalPlural,
      customerSingular: v.customerSingular,
      customerPlural: v.customerPlural,
      pointsSingular: v.pointsSingular,
      pointsPlural: v.pointsPlural,
      club: v.club,
    })
  })
  await passo(falhas, 'modulos', async () => {
    await updateModules(admin, id, { loyalty: v.loyalty, banners: v.banners, store: v.store, vouchers: v.vouchers })
  })
  await passo(falhas, 'regras', async () => {
    await updateRulesAsAdmin(admin, id, regrasDe(v))
  })
  let chave: { name: string; secret: string } | null = null
  if (v.createKey) {
    await passo(falhas, 'chave', async () => {
      const k = await createApiKey(admin, { kind: 'ACCOUNT', businessId: id, name: v.keyName.trim() })
      chave = { name: k.key.name, secret: k.secret }
    })
  }

  const feita = chave as { name: string; secret: string } | null
  return {
    createdId: id,
    businessName: criada.business.name,
    entryUrl: criada.business.entryUrl,
    ownerEmail: v.ownerEmail.trim().toLowerCase(),
    ownerExisting: criada.owner.existing,
    emailSent: criada.emailSent,
    pendencias: falhas.map((f) => FALTOU[f.codigo] ?? f.codigo),
    ...(feita ? { keyName: feita.name, secret: feita.secret } : {}),
    faltou: falhas.map((f) => f.codigo),
  }
}

function concluir({ faltou, ...resultado }: WizardResult & { faltou: string[] }, v: WizardData): FormState<WizardData> {
  // Sem segredo para mostrar e com algo faltando: a página da conta é o lugar de completar. O aviso vai por código, nunca o segredo.
  if (faltou.length > 0 && resultado.secret === undefined) {
    redirect(`/contas/${resultado.createdId}?faltou=${faltou.join(',')}`)
  }
  return { ok: true, message: null, fields: {}, values: { ...pickValues(v), result: resultado } }
}

/** Cria a conta inteira numa ação só: conta e dono, marca, logo, termos, módulos, regras e chave, nesta ordem. */
export const criarConta = adminAction(readValues, executar, concluir)
