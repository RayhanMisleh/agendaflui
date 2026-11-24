import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { OnboardingProgress, OnboardingStep } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError } from '@/server/domain/errors'

export type OnboardingStepKey = OnboardingStep

export type OnboardingStepDef = {
  key: OnboardingStepKey
  slug: 'loja' | 'marca' | 'animais' | 'servicos' | 'expediente' | 'equipe' | 'link'
  label: string
  /** Só existe em conta com nicho (a pergunta de gatos é do pet shop). */
  nicheOnly: boolean
}

/** Os passos na ordem da spec. */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { key: 'STORE', slug: 'loja', label: 'Dados da loja', nicheOnly: false },
  { key: 'BRAND', slug: 'marca', label: 'Marca', nicheOnly: false },
  { key: 'ANIMALS', slug: 'animais', label: 'Animais atendidos', nicheOnly: true },
  { key: 'SERVICES', slug: 'servicos', label: 'Serviços', nicheOnly: false },
  { key: 'HOURS', slug: 'expediente', label: 'Expediente', nicheOnly: false },
  { key: 'TEAM', slug: 'equipe', label: 'Equipe', nicheOnly: false },
  { key: 'LINK', slug: 'link', label: 'Link para clientes', nicheOnly: false },
]

export type OnboardingStatus = 'done' | 'skipped' | 'todo'

export type OnboardingView = {
  steps: { key: OnboardingStepKey; slug: string; label: string; status: OnboardingStatus }[]
  done: number
  total: number
  /** O primeiro passo não feito (os pendentes antes dos pulados); `null` com tudo feito. */
  current: OnboardingStepKey | null
  wizardFinished: boolean
  completed: boolean
  dismissed: boolean
  /** Quando o começo foi concluído (para a mensagem de "tudo pronto" durar um dia). */
  completedAt: Date | null
}

const MAX_TENTATIVAS = 3

type Fatos = { hasNiche: boolean; hasService: boolean; hasHours: boolean }

/** O que já existe na loja e conta como passo feito: serviço ativo e expediente de algum profissional ativo. */
async function lerFatos(ctx: TenantContext): Promise<Fatos> {
  const conta = await ctx.db.business.findUnique({ where: { id: ctx.businessId }, select: { niche: true } })
  const servico = await ctx.db.service.findFirst({ where: { active: true, archivedAt: null }, select: { id: true } })
  const horas = await ctx.db.workingHours.findFirst({
    where: { professional: { active: true, archivedAt: null } },
    select: { id: true },
  })
  return { hasNiche: conta?.niche != null, hasService: servico !== null, hasHours: horas !== null }
}

function viewOf(
  row: Pick<OnboardingProgress, 'doneSteps' | 'skippedSteps' | 'wizardFinishedAt' | 'completedAt' | 'dismissedAt'>,
  fatos: Fatos,
): OnboardingView {
  const steps = ONBOARDING_STEPS.filter((s) => !s.nicheOnly || fatos.hasNiche).map((s) => {
    const existente = (s.key === 'SERVICES' && fatos.hasService) || (s.key === 'HOURS' && fatos.hasHours)
    const status: OnboardingStatus = existente || row.doneSteps.includes(s.key) ? 'done' : row.skippedSteps.includes(s.key) ? 'skipped' : 'todo'
    return { key: s.key, slug: s.slug, label: s.label, status }
  })
  const current = steps.find((s) => s.status === 'todo') ?? steps.find((s) => s.status === 'skipped') ?? null
  return {
    steps,
    done: steps.filter((s) => s.status === 'done').length,
    total: steps.length,
    current: current?.key ?? null,
    wizardFinished: row.wizardFinishedAt !== null,
    completed: row.completedAt !== null,
    dismissed: row.dismissedAt !== null,
    completedAt: row.completedAt,
  }
}

function semProgresso(): DomainError {
  return new DomainError('not_found', 'Esta conta não tem o passo a passo de começo.')
}

function versaoVelha(): DomainError {
  return new DomainError('conflict', 'Outra aba mudou o começo ao mesmo tempo. Recarregue a página e tente de novo.', { reason: 'stale_version' })
}

/** O começo da conta. Só o dono (`manage_account`) o lê; conta sem linha de progresso não tem começo (`null`). */
export async function getOnboarding(ctx: TenantContext): Promise<OnboardingView | null> {
  if (!can(ctx.actor, 'manage_account')) return null
  const row = await ctx.db.onboardingProgress.findUnique({ where: { businessId: ctx.businessId } })
  if (row === null) return null
  const view = viewOf(row, await lerFatos(ctx))
  if (row.completedAt !== null || view.done !== view.total) return view
  // Todos os passos já valem (um pulado foi feito depois, fora do passo a passo): conclui aqui, senão nada mais marcaria `completedAt`.
  // Uma leitura não sobe a versão: ela só confere gravações de passos, e um formulário aberto não pode dar conflito por causa de um GET.
  const agora = ctx.clock()
  await ctx.db.onboardingProgress.updateMany({ where: { businessId: ctx.businessId, completedAt: null }, data: { completedAt: agora } })
  const atual = await ctx.db.onboardingProgress.findUnique({ where: { businessId: ctx.businessId } })
  return atual === null ? view : viewOf(atual, await lerFatos(ctx))
}

/**
 * Marca um passo como feito ou pulado. As marcas se juntam: feito tira dos pulados, pulado nunca rebaixa um feito, e duas
 * abas marcando passos diferentes não se sobrescrevem (a gravação é condicionada à versão lida; se mudou, lê e junta de novo).
 */
export async function markOnboardingStep(ctx: TenantContext, step: OnboardingStepKey, how: 'done' | 'skipped'): Promise<OnboardingView> {
  authorize(ctx, 'manage_account')
  const fatos = await lerFatos(ctx)
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
    const row = await ctx.db.onboardingProgress.findUnique({ where: { businessId: ctx.businessId } })
    if (row === null) throw semProgresso()
    const feitos = new Set(row.doneSteps)
    const pulados = new Set(row.skippedSteps)
    if (how === 'done') {
      feitos.add(step)
      pulados.delete(step)
    } else if (!feitos.has(step)) {
      pulados.add(step)
    }
    const mudou = feitos.size !== row.doneSteps.length || pulados.size !== row.skippedSteps.length
    const novo = { ...row, doneSteps: [...feitos], skippedSteps: [...pulados] }
    const antes = viewOf(row, fatos)
    const depois = viewOf(novo, fatos)
    const conclui = row.completedAt === null && depois.done === depois.total
    if (!mudou && !conclui) return antes
    const ok = await ctx.db.$transaction(async (tx) => {
      const r = await tx.onboardingProgress.updateMany({
        where: { businessId: ctx.businessId, version: row.version },
        data: {
          doneSteps: [...feitos],
          skippedSteps: [...pulados],
          ...(conclui ? { completedAt: ctx.clock() } : {}),
          version: { increment: 1 },
        },
      })
      if (r.count === 0) return false
      await audit(ctx, { action: 'onboarding.step_marked', targetType: 'OnboardingProgress', targetId: row.id, metadata: { step, how } }, tx)
      return true
    })
    if (ok) return viewOf({ ...novo, completedAt: conclui ? ctx.clock() : row.completedAt }, fatos)
  }
  throw versaoVelha()
}

async function marcarMomento(ctx: TenantContext, campo: 'wizardFinishedAt' | 'dismissedAt', action: string): Promise<void> {
  authorize(ctx, 'manage_account')
  const row = await ctx.db.onboardingProgress.findUnique({ where: { businessId: ctx.businessId } })
  if (row === null) throw semProgresso()
  if (row[campo] !== null) return
  await ctx.db.$transaction(async (tx) => {
    const r = await tx.onboardingProgress.updateMany({
      where: { businessId: ctx.businessId, [campo]: null },
      data: { [campo]: ctx.clock(), version: { increment: 1 } },
    })
    if (r.count === 0) return
    await audit(ctx, { action, targetType: 'OnboardingProgress', targetId: row.id }, tx)
  })
}

/** O dono chegou ao fim do passo a passo. Repetir não grava de novo. */
export async function finishOnboardingWizard(ctx: TenantContext): Promise<void> {
  await marcarMomento(ctx, 'wizardFinishedAt', 'onboarding.finished')
}

/** O dono dispensou o passo a passo: para o redirecionamento e some a lista do Início. Repetir não grava de novo. */
export async function dismissOnboarding(ctx: TenantContext): Promise<void> {
  await marcarMomento(ctx, 'dismissedAt', 'onboarding.dismissed')
}

/** Só o dono é levado ao começo, e só enquanto não terminou, concluiu nem dispensou. O suporte nunca é levado. */
export async function shouldRedirectToOnboarding(ctx: TenantContext): Promise<boolean> {
  if (ctx.actor.kind !== 'member' || ctx.actor.role !== 'OWNER') return false
  const row = await ctx.db.onboardingProgress.findUnique({ where: { businessId: ctx.businessId } })
  return row !== null && row.wizardFinishedAt === null && row.completedAt === null && row.dismissedAt === null
}
