import type { MembershipRole } from '@/server/db/generated/client'

/** Papel em português para a pessoa. */
export function roleLabel(role: MembershipRole): 'Dono' | 'Gerente' | 'Profissional' {
  switch (role) {
    case 'OWNER':
      return 'Dono'
    case 'MANAGER':
      return 'Gerente'
    case 'PROFESSIONAL':
      return 'Profissional'
  }
}
