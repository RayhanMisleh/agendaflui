import type { MembershipRole } from '@/server/db/generated/client'

/** Papel em português para a pessoa. O profissional leva o termo que a conta usa ("Barbeiro", "Tosador"). */
export function roleLabel(role: MembershipRole, professionalTerm: string): string {
  switch (role) {
    case 'OWNER':
      return 'Dono'
    case 'MANAGER':
      return 'Gerente'
    case 'PROFESSIONAL':
      return professionalTerm
  }
}
