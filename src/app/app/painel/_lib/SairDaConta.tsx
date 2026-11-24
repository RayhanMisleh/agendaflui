import { LogOut } from 'lucide-react'
import { SubmitButton } from '@/ui/components'
import { logout } from './actions'

export function SairDaConta({ variant = 'secondary' }: { variant?: 'secondary' | 'ghost' }) {
  return (
    <form action={logout}>
      <SubmitButton variant={variant} icon={<LogOut size={18} />}>
        Sair
      </SubmitButton>
    </form>
  )
}
