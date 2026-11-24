import { LinkButton } from '@/ui/components'
import { EntryScreen } from '@/ui/shells'

export default function NotFound() {
  return (
    <EntryScreen
      brand={{ name: 'Agenda Flui', logoUrl: null, symbolUrl: null, loginImageUrl: null, platform: true }}
      headline="A agenda que flui."
      title="Página não encontrada"
      message="O endereço pode ter mudado ou nunca ter existido."
      testId="nao-encontrado"
    >
      <div className="af-entry__form">
        <LinkButton href="/" variant="primary" size="lg">
          Ir para o início
        </LinkButton>
      </div>
    </EntryScreen>
  )
}
