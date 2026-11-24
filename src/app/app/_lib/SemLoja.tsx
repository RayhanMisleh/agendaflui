import { LinkButton } from '@/ui/components'
import { EntryScreen } from '@/ui/shells'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { SairDaConta } from '@/app/app/painel/_lib/SairDaConta'

const MARCA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, loginImageUrl: null, platform: true }

/** Pessoa com conta, sem equipe e sem loja: diz como chegar a uma loja e deixa ir para Minha conta ou sair. */
export function SemLoja() {
  return (
    <EntryScreen
      theme={deriveTheme(AGENDAFLUI_BRAND)}
      brand={MARCA}
      headline="A agenda que flui."
      title="Sua conta ainda não está em nenhuma loja"
      message="Entre pelo link que a sua loja enviou."
      testId="sem-loja"
    >
      <div className="af-entry__form">
        <LinkButton href="/conta" variant="secondary" size="lg">
          Minha conta
        </LinkButton>
        <SairDaConta variant="ghost" />
      </div>
    </EntryScreen>
  )
}
