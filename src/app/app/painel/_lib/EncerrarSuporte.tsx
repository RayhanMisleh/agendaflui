import { LogOut } from 'lucide-react'
import { Button } from '@/ui/components'
import { encerrarSuporte } from './actions'

/** Botão da faixa de suporte: apaga a sessão de suporte e volta ao painel dev. */
export function EncerrarSuporte() {
  return (
    <form action={encerrarSuporte}>
      <Button type="submit" variant="secondary" size="sm" icon={<LogOut size={16} />}>
        Encerrar
      </Button>
    </form>
  )
}
