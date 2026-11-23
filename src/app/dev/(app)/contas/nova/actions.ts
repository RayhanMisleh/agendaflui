'use server'
import { redirect, unstable_rethrow } from 'next/navigation'
import { DomainError } from '@/server/domain/errors'
import { createApiKey, validateApiKeyName } from '@/server/domain/platform/api-keys'
import { createBusiness, validateNewBusiness } from '@/server/domain/platform/businesses'
import { getCustomization, updateBrand, updateModules, updateRulesAsAdmin, updateTerms, validateAccountSetup } from '@/server/domain/platform/customization'
import type { BrandInput } from '@/server/domain/platform/customization'
import type { SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { adminAction } from '../../_lib/action'
import type { PlatformAdminActor } from '../../_lib/action'
import { renomear } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'
import { pickValues, readValues } from './fields'
import type { TermSet, WizardData, WizardResult } from './fields'

function vazio(valor: string): boolean {
  return valor.trim() === ''
}

const ROTULO_DOMINIO: Record<string, string> = { 'owner.name': 'ownerName', 'owner.email': 'ownerEmail' }

function dadosDaConta(v: WizardData) {
  return {
    name: v.name,
    slug: v.slug,
    ...(vazio(v.document) ? {} : { document: v.document }),
    ...(vazio(v.contactEmail) ? {} : { contactEmail: v.contactEmail }),
    ...(vazio(v.contactPhone) ? {} : { contactPhone: v.contactPhone }),
    owner: { name: v.ownerName, email: v.ownerEmail },
  }
}

function termosDe(v: WizardData): TermSet {
  return {
    professionalSingular: v.professionalSingular,
    professionalPlural: v.professionalPlural,
    customerSingular: v.customerSingular,
    customerPlural: v.customerPlural,
    pointsSingular: v.pointsSingular,
    pointsPlural: v.pointsPlural,
    club: v.club,
  }
}

function marcaDe(v: WizardData): BrandInput {
  return {
    displayName: v.displayName,
    primary: v.primary,
    accent: v.accent,
    material: v.material,
  }
}

/**
 * Confere, ANTES de criar a conta, tudo o que as etapas pedem, de uma vez só, com as funções de pré-validação do domínio
 * (os mesmos esquemas das funções de escrita). Assim um erro de digitação não deixa uma conta criada pela metade, e os erros de
 * todas as etapas aparecem juntos. Nenhuma regra mora aqui.
 */
function conferirAntes(v: WizardData): Record<string, string> {
  const erros: Record<string, string> = {}
  for (const [campo, msg] of Object.entries(validateNewBusiness(dadosDaConta(v)))) erros[ROTULO_DOMINIO[campo] ?? campo] = msg
  Object.assign(
    erros,
    validateAccountSetup({
      brand: marcaDe(v),
      terms: termosDe(v),
      modules: { loyalty: v.loyalty, banners: v.banners, store: v.store, vouchers: v.vouchers },
      rules: regrasDe(v),
    }),
  )
  if (v.createKey) {
    const msg = validateApiKeyName(v.keyName)
    if (msg) erros.keyName = msg
  }
  return erros
}

function numero(valor: string): number | undefined {
  return vazio(valor) ? undefined : Number(valor)
}

function regrasDe(v: WizardData): Partial<SchedulingRules> {
  const regras: Partial<SchedulingRules> = { autoConfirm: v.autoConfirm }
  const campos = ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const
  for (const c of campos) {
    const n = numero(v[c])
    if (n !== undefined) regras[c] = n
  }
  return regras
}

const PENDENCIA = {
  marca: 'A marca (cores e barra lateral) não foi salva',
  termos: 'Os termos não foram salvos',
  modulos: 'Os módulos não foram salvos',
  regras: 'As regras de agenda não foram salvas',
  chave: 'A chave de app não foi criada',
} as const

type Falha = { codigo: keyof typeof PENDENCIA; motivo: string | null }

/** Roda um passo depois da criação. Erro vira pendência com o motivo do domínio; erro inesperado só deixa o NOME no log. */
async function passo(falhas: Falha[], codigo: Falha['codigo'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof DomainError) {
      falhas.push({ codigo, motivo: err.message })
      return
    }
    console.error(JSON.stringify({ level: 'error', event: 'dev_create_account_step_failed', step: codigo, error: err instanceof Error ? err.name : 'unknown' }))
    falhas.push({ codigo, motivo: null })
  }
}

async function executar(admin: PlatformAdminActor, v: WizardData): Promise<WizardResult & { faltou: string[] }> {
  const erros = conferirAntes(v)
  if (Object.keys(erros).length > 0) {
    throw new DomainError('validation', 'Confira os campos marcados e tente de novo.', { fields: erros })
  }

  let criada: Awaited<ReturnType<typeof createBusiness>>
  try {
    criada = await createBusiness(admin, dadosDaConta(v))
  } catch (err) {
    // Erros do domínio usam `owner.email`; o formulário chama de `ownerEmail`.
    throw renomear(err, ROTULO_DOMINIO)
  }
  const id = criada.business.id
  const falhas: Falha[] = []

  await passo(falhas, 'marca', async () => {
    const atual = await getCustomization(admin, id)
    await updateBrand(admin, id, atual.brand.version, marcaDe(v))
  })
  await passo(falhas, 'termos', async () => {
    await updateTerms(admin, id, termosDe(v))
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
    pendencias: falhas.map((f) => (f.motivo ? `${PENDENCIA[f.codigo]}: ${f.motivo}` : `${PENDENCIA[f.codigo]}.`)),
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
export const criarConta = adminAction<WizardData, WizardResult & { faltou: string[] }>(readValues, executar, concluir)
