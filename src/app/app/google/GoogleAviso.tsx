import { CircleAlert, CircleCheck } from 'lucide-react'
import { googleMessage } from './mensagens'

/** O resultado do Google na URL (`?google=<código>`), em `role="alert"` (ou `status` no sucesso). Código desconhecido: nada. */
export function GoogleAviso({ codigo }: { codigo: string }) {
  const m = googleMessage(codigo)
  if (m === null) return null
  const Icone = m.ok ? CircleCheck : CircleAlert
  return (
    <p role={m.ok ? 'status' : 'alert'} className={m.ok ? 'af-entry__notice' : 'af-entry__error'}>
      <Icone size={18} aria-hidden="true" />
      <span>{m.text}</span>
    </p>
  )
}

/** O divisor "ou" entre o botão do Google e o formulário. */
export function GoogleOu() {
  return (
    <div className="af-entry__or" role="separator" aria-label="ou">
      <span>ou</span>
    </div>
  )
}
