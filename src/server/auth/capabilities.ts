import type { MembershipRole } from '@/server/db/generated/client'
import type { Actor } from './actor'

export const CAPABILITIES = [
  'view_dashboard',
  'view_own_agenda',
  'manage_own_availability',
  'view_clients',
  'view_own_reports',
  'view_all_agendas',
  'view_all_reports',
  'manage_clients',
  'manage_team',
  'manage_catalog',
  'manage_settings',
  'manage_account',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const BASICAS: readonly Capability[] = CAPABILITIES.slice(0, 5)

const POR_PAPEL: Record<MembershipRole, readonly Capability[]> = {
  PROFESSIONAL: BASICAS,
  MANAGER: CAPABILITIES.filter((c) => c !== 'manage_account'),
  OWNER: CAPABILITIES,
}

export function can(actor: Actor, capability: Capability): boolean {
  switch (actor.kind) {
    case 'member':
      return POR_PAPEL[actor.role].includes(capability)
    case 'impersonator':
      // Suporte (admin da plataforma "entrando como"): tem os poderes do dono sobre os dados da conta. Não faz, e `can()`
      // não é o lugar de liberar: (1) mudar a senha de ninguém, (2) ver segredos (senhas, tokens, chaves), (3) rebaixar ou
      // desativar donos pelo painel do negócio. Quando a tela ou a ação de (3) existir, ela precisa recusar
      // `actor.kind === 'impersonator'` por conta própria, mesmo com `manage_team`; o admin faz isso pelo painel dev.
      return true
    case 'platform_admin':
      // Só o que o painel dev precisa fazer numa conta: regras, avisos e afins (`manage_settings`). Equipe, catálogo,
      // clientes e a conta em si ficam de fora; para isso o admin entra como suporte.
      return capability === 'manage_settings'
    case 'customer':
    case 'system':
    case 'guest':
      return false
  }
}
