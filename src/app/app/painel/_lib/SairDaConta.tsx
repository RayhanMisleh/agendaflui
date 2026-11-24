import { LogOut } from 'lucide-react'
import { Button } from '@/ui/components'
import { logout } from './actions'

export function SairDaConta({ variant = 'secondary' }: { variant?: 'secondary' | 'ghost' }) {
  return (
    <form action={logout}>
      <Button type="submit" variant={variant} icon={<LogOut size={18} />}>
        Sair
      </Button>
    </form>
  )
}
