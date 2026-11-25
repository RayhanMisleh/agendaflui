import { Input } from '@/ui/components'
import { Pergunta, type PassoProps } from './Pergunta'

export function Nome({ a, set, error }: PassoProps) {
  return (
    <Pergunta step="name" error={error}>
      <Input
        name="name"
        aria-label="Nome do pet"
        className="af-cl-quiz__bignput"
        value={a.name}
        onChange={(e) => set({ name: e.target.value })}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        autoFocus
        invalid={error !== null}
      />
    </Pergunta>
  )
}
