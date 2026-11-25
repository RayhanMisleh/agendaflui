'use client'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/ui/components'

/** Campo de senha com o botão "Mostrar senha" (alvo de toque de 44 px). Nunca guarda a senha: só alterna o tipo do campo. */
export function PasswordInput({ ...rest }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="af-pass">
      <Input {...rest} type={visivel ? 'text' : 'password'} className="af-pass__input" autoCapitalize="none" spellCheck={false} />
      <button type="button" className="af-pass__toggle" onClick={() => setVisivel((v) => !v)} aria-pressed={visivel} aria-label={visivel ? 'Esconder senha' : 'Mostrar senha'}>
        {visivel ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  )
}
