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
      // Suporte (admin da plataforma "entrando como"): tem os poderes do dono sobre os dados da conta, inclusive os acessos
      // da equipe (convidar, papel, desativar), sempre sob a regra do último dono. `can()` não é o lugar das exceções; as
      // funções de domínio recusam `actor.kind === 'impersonator'` por conta própria (`forbidden`), mesmo com `manage_team`:
      // (1) trocar ou redefinir a senha de alguém (`sendAccessPasswordReset`, `changeOwnAccountPassword`), (2) agir como
      // "eu" (`getOwnAccountProfile`, `updateOwnAccountProfile`: o suporte não é um usuário da conta), (3) ver segredos
      // (senhas, tokens, chaves). Um teste (`account-profile.test.ts`) percorre essas funções com o ator de suporte.
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
