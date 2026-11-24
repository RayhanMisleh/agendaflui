'use server'
import { redirect } from 'next/navigation'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import { dismissOnboarding, finishOnboardingWizard, getOnboarding, markOnboardingStep, ONBOARDING_STEPS } from '@/server/domain/onboarding/progress'
import type { OnboardingStepKey, OnboardingView } from '@/server/domain/onboarding/progress'
import { applyServiceSuggestions, inviteTeamFromOnboarding, setupOwnerSchedule } from '@/server/domain/onboarding/steps'
import type { SuggestionRow } from '@/server/domain/onboarding/steps'
import { updateBusinessProfile, updateBrandColors } from '@/server/domain/settings/business-profile'
import { updateNicheOptions } from '@/server/domain/settings/niche-settings'
import { NICHES } from '@/server/niches'
import { isServiceIcon } from '@/shared/service-icons'
import { parseMoney } from '@/ui/money'
import { erroDeCampo, ler } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../_lib/action'
import { expedienteDe, faixaDoFormulario, lerFaixas } from '../_lib/expediente'
import { atualizarPainel } from '../_lib/revalidar'
import { comConflito } from '../configuracoes/versao'

/*
 * Ações do começo do dono. Todas passam por `tenantAction('manage_account')` (o domínio confere de novo) e, ao fim de cada
 * passo, redirecionam para o seguinte. Quem manda o passo é o servidor: o formulário só leva os campos. Repetir um envio
 * (duplo clique, duas abas) é inofensivo: as marcas do progresso se juntam e os serviços que já existem são pulados.
 */

const aRota = (slug: string): string => `/painel/comecar?passo=${slug}`

/** O endereço do passo que vem depois de `key` (o último passo volta a si mesmo). */
function depoisDe(view: OnboardingView | null, key: OnboardingStepKey): string {
  const passos = view?.steps ?? []
  const i = passos.findIndex((s) => s.key === key)
  const proximo = passos[i + 1] ?? passos[passos.length - 1]
  return proximo ? aRota(proximo.slug) : '/painel'
}

async function marcarEIr(ctx: TenantContext, key: OnboardingStepKey, how: 'done' | 'skipped' = 'done'): Promise<string> {
  const view = await markOnboardingStep(ctx, key, how)
  atualizarPainel()
  return depoisDe(view, key)
}

/** Para os passos cujo domínio já marca: só lê o progresso e diz para onde ir. */
async function irDepoisDe(ctx: TenantContext, key: OnboardingStepKey): Promise<string> {
  atualizarPainel()
  return depoisDe(await getOnboarding(ctx), key)
}

/** O fim de toda ação de passo: segue para o endereço que a ação devolveu. */
function ir(destino: string): never {
  return redirect(destino)
}

// ---------------------------------------------------------------- loja

export const salvarLoja = tenantAction(
  'manage_account',
  (fd) => ler(fd, ['version', 'name', 'contactEmail', 'contactPhone']),
  async (ctx, v) => {
    try {
      await updateBusinessProfile(ctx, Number(v.version), { name: v.name ?? '', contactEmail: v.contactEmail ?? '', contactPhone: v.contactPhone ?? '' })
    } catch (err) {
      throw comConflito(err)
    }
    return marcarEIr(ctx, 'STORE')
  },
  ir,
)

// ---------------------------------------------------------------- marca

export const salvarMarca = tenantAction(
  'manage_account',
  (fd) => ler(fd, ['version', 'primary', 'accent']),
  async (ctx, v) => {
    try {
      await updateBrandColors(ctx, Number(v.version), { primary: (v.primary ?? '').trim(), accent: (v.accent ?? '').trim() })
    } catch (err) {
      throw comConflito(err)
    }
    return marcarEIr(ctx, 'BRAND')
  },
  ir,
)

// ---------------------------------------------------------------- animais

export const salvarAnimais = tenantAction(
  'manage_account',
  (fd) => ler(fd, ['version'], ['servesCats']),
  async (ctx, v) => {
    try {
      await updateNicheOptions(ctx, { servesCats: v.servesCats === 'on', version: Number(v.version) })
    } catch (err) {
      throw comConflito(err)
    }
    return marcarEIr(ctx, 'ANIMALS')
  },
  ir,
)

// ---------------------------------------------------------------- serviços

const VARIANTES = NICHES.PET.variants.map((d) => d.key)
const MAX_LINHAS_SERVICO = 20

/** Os campos de uma linha de serviço: `s_<i>_on|name|icon|desc` e, por porte, `s_<i>_<PORTE>_price|duration`. */
function lerServicos(fd: FormData): Campos {
  const n = Math.min(MAX_LINHAS_SERVICO, Math.max(0, Math.trunc(Number(fd.get('n'))) || 0))
  const nomes = ['n']
  const caixas: string[] = []
  for (let i = 0; i < n; i += 1) {
    caixas.push(`s_${i}_on`)
    nomes.push(`s_${i}_name`, `s_${i}_icon`, `s_${i}_desc`)
    for (const v of VARIANTES) nomes.push(`s_${i}_${v}_price`, `s_${i}_${v}_duration`)
  }
  const campos = ler(fd, nomes, caixas)
  campos.n = String(n)
  return campos
}

export const salvarServicos = tenantAction(
  'manage_account',
  lerServicos,
  async (ctx, v) => {
    const n = Number(v.n)
    const linhas: SuggestionRow[] = []
    const origem: number[] = []
    for (let i = 0; i < n; i += 1) {
      if (v[`s_${i}_on`] !== 'on') continue
      const name = (v[`s_${i}_name`] ?? '').trim()
      if (name === '') throw erroDeCampo(`s_${i}_name`, 'Informe o nome do serviço.')
      const icon = v[`s_${i}_icon`] ?? ''
      const prices: SuggestionRow['prices'] = []
      for (const variant of VARIANTES) {
        const texto = (v[`s_${i}_${variant}_price`] ?? '').trim()
        if (texto === '') continue
        const priceCents = parseMoney(texto)
        if (priceCents === null) throw erroDeCampo(`s_${i}_${variant}_price`, 'Digite o preço em reais, por exemplo 35,90.')
        const durationMin = Number(v[`s_${i}_${variant}_duration`])
        if (!Number.isInteger(durationMin)) throw erroDeCampo(`s_${i}_${variant}_duration`, 'Escolha a duração.')
        prices.push({ variant, priceCents, durationMin })
      }
      if (prices.length === 0) throw erroDeCampo(`s_${i}_name`, `Preencha o preço de pelo menos um porte em "${name}".`)
      const descricao = (v[`s_${i}_desc`] ?? '').trim()
      linhas.push({ name, icon: isServiceIcon(icon) ? icon : 'sparkles', description: descricao === '' ? null : descricao, prices })
      origem.push(i)
    }
    if (linhas.length === 0) throw new DomainError('validation', 'Marque pelo menos um serviço, ou pule este passo.')
    try {
      await applyServiceSuggestions(ctx, linhas)
    } catch (err) {
      // Os erros do domínio apontam a linha enviada (`rows.<k>`); a tela conhece a posição na tabela.
      if (err instanceof DomainError && err.fields) {
        const fields = Object.fromEntries(
          Object.entries(err.fields).map(([campo, msg]) => {
            const k = /^rows\.(\d+)/.exec(campo)?.[1]
            const posicao = k === undefined ? undefined : origem[Number(k)]
            return [posicao === undefined ? campo : `s_${posicao}_name`, msg]
          }),
        )
        throw new DomainError(err.code, err.message, { fields })
      }
      throw err
    }
    return irDepoisDe(ctx, 'SERVICES')
  },
  ir,
)

// ---------------------------------------------------------------- expediente

export const salvarExpediente = tenantAction(
  'manage_account',
  (fd) => lerFaixas(fd, ler(fd, ['attends'])),
  async (ctx, v) => {
    if (v.attends === 'sim') {
      try {
        await setupOwnerSchedule(ctx, { attends: true, schedule: expedienteDe(v) })
      } catch (err) {
        throw faixaDoFormulario(err)
      }
    } else {
      await setupOwnerSchedule(ctx, { attends: false })
    }
    return irDepoisDe(ctx, 'HOURS')
  },
  ir,
)

// ---------------------------------------------------------------- equipe

const MAX_PESSOAS = 5
const camposDaEquipe = (n: number): string[] => Array.from({ length: n }, (_, i) => [`t_${i}_name`, `t_${i}_email`, `t_${i}_role`]).flat()

function lerEquipe(fd: FormData): Campos {
  const n = Math.min(MAX_PESSOAS, Math.max(1, Math.trunc(Number(fd.get('n'))) || 1))
  const campos = ler(fd, ['n', ...camposDaEquipe(n)])
  campos.n = String(n)
  return campos
}

export const convidarEquipe = tenantAction(
  'manage_account',
  lerEquipe,
  async (ctx, v) => {
    const n = Number(v.n)
    const linhas: { name: string; email: string; role: 'PROFESSIONAL' | 'MANAGER' }[] = []
    const posicoes: number[] = []
    for (let i = 0; i < n; i += 1) {
      const name = (v[`t_${i}_name`] ?? '').trim()
      const email = (v[`t_${i}_email`] ?? '').trim()
      if (name === '' && email === '') continue
      linhas.push({ name, email, role: v[`t_${i}_role`] === 'MANAGER' ? 'MANAGER' : 'PROFESSIONAL' })
      posicoes.push(i)
    }
    if (linhas.length === 0) throw new DomainError('validation', 'Informe pelo menos uma pessoa, ou pule este passo.')
    const r = await inviteTeamFromOnboarding(ctx, linhas)
    atualizarPainel()
    const erros = Object.entries(r.errors).map(([k, msg]) => [posicoes[Number(k)] ?? 0, msg] as const)
    return { ...r, erros, posicoes, destino: erros.length === 0 ? await irDepoisDe(ctx, 'TEAM') : null }
  },
  (r, v) => {
    if (r.destino !== null) return redirect(r.destino)
    // As linhas enviadas saem do formulário (reenviar não convida de novo); as que falharam ficam com a mensagem.
    const values: Campos = { ...v }
    const falharam = new Set(r.erros.map(([i]) => i))
    for (const i of r.posicoes) {
      if (falharam.has(i)) continue
      values[`t_${i}_name`] = ''
      values[`t_${i}_email`] = ''
    }
    const fields = Object.fromEntries(r.erros.map(([i, msg]) => [`t_${i}_email`, msg]))
    const enviados = r.invited === 0 ? '' : r.invited === 1 ? '1 convite enviado. ' : `${r.invited} convites enviados. `
    return { ok: false, message: `${enviados}Corrija as pessoas com erro e envie de novo.`, fields, values }
  },
)

// ---------------------------------------------------------------- navegação

const CHAVES = new Set<string>(ONBOARDING_STEPS.map((s) => s.key))

export const pularPasso = tenantAction(
  'manage_account',
  (fd) => ler(fd, ['passo']),
  async (ctx, v) => {
    const passo = ONBOARDING_STEPS.find((s) => s.key === v.passo && CHAVES.has(s.key))
    if (!passo) throw new DomainError('validation', 'Este passo não existe.')
    return marcarEIr(ctx, passo.key, 'skipped')
  },
  ir,
)

export const terminar = tenantAction(
  'manage_account',
  () => ({}) as Campos,
  async (ctx) => {
    await markOnboardingStep(ctx, 'LINK', 'done')
    await finishOnboardingWizard(ctx)
    atualizarPainel()
    return '/painel'
  },
  ir,
)

export const dispensar = tenantAction(
  'manage_account',
  () => ({}) as Campos,
  async (ctx) => {
    await dismissOnboarding(ctx)
    atualizarPainel()
    return '/painel'
  },
  ir,
)
