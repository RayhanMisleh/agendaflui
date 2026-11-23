'use client'
import type { ReactNode } from 'react'
import { CalendarDays, ChartNoAxesColumn, House, Scissors, Settings, UserRound, Users } from 'lucide-react'
import { Button, Card, EmptyState, StatNumber } from '@/ui/components'
import type { CoverMaterial } from '@/ui/theme/derive'
import { DevShell, EntryScreen, PainelShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { DEMO_ACCOUNTS } from './accounts'

const NAV_PAINEL: NavItem[] = [
  { href: '/dev/vitrine', label: 'Início', icon: House, active: true },
  { href: '/dev/vitrine', label: 'Agenda', icon: CalendarDays, active: false },
  { href: '/dev/vitrine', label: 'Clientes', icon: Users, active: false },
  { href: '/dev/vitrine', label: 'Equipe', icon: UserRound, active: false },
  { href: '/dev/vitrine', label: 'Serviços', icon: Scissors, active: false },
  { href: '/dev/vitrine', label: 'Relatórios', icon: ChartNoAxesColumn, active: false },
  { href: '/dev/vitrine', label: 'Configurações', icon: Settings, active: false, disabled: true },
]
const NAV_CURTA = NAV_PAINEL.slice(0, 4)
const NAV_DEV: NavItem[] = NAV_PAINEL.slice(0, 5)

const ESTILOS: ReadonlyArray<{ material: CoverMaterial; nome: string }> = [
  { material: 'LEATHER', nome: 'Cheia' },
  { material: 'LINEN', nome: 'Suave' },
  { material: 'WOOD', nome: 'Noite' },
  { material: 'ENAMEL', nome: 'Clara' },
]

const CONTA = DEMO_ACCOUNTS.find((a) => a.id === 'patas') ?? DEMO_ACCOUNTS[0]!
const USUARIO = { name: 'Marina Lopes', roleLabel: 'Dona', avatarUrl: null }

function Conteudo() {
  return (
    <div className="vt-frame-body">
      <Card variant="block" bubbles>
        <p className="vt-body-lg">Hoje, terça, 17</p>
      </Card>
      <Card>
        <StatNumber value={9} label="Atendimentos" format="int" />
      </Card>
      <Card>
        <EmptyState title="Sem horários livres" description="Abra uma vaga para receber mais gente." />
      </Card>
    </div>
  )
}

function Quadro({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'vt-spec vt-spec--wide' : 'vt-spec'}>
      <h3 className="vt-h3">{title}</h3>
      {note ? <p className="vt-note">{note}</p> : null}
      <div className="vt-spec__body">{children}</div>
    </div>
  )
}

/** As molduras e as telas de entrada em miniatura: cada uma rola dentro do próprio quadro. */
export function Molduras() {
  const conta = (material: CoverMaterial) => deriveTheme({ ...CONTA.brand, material })
  const acoes = (
    <>
      <Button variant="secondary">Sair</Button>
    </>
  )
  return (
    <section aria-labelledby="vt-molduras" className="vt-section">
      <h2 id="vt-molduras" className="af-h2 vt-h2">
        Molduras e entrada
      </h2>
      <div className="vt-specs">
        {ESTILOS.map((e, i) => (
          <Quadro key={e.material} title={`Painel do negócio, barra ${e.nome}`} note="Computador: barra de 264 px, destino ativo em pílula." wide>
            <PainelShell
              embedded
              testId={`vt-painel-${i}`}
              contentId={`vt-painel-${i}-c`}
              headingLevel={2}
              theme={conta(e.material)}
              brand={{ name: CONTA.name, logoUrl: null, symbolUrl: null }}
              nav={NAV_PAINEL}
              user={USUARIO}
              accountActions={acoes}
              title="Início"
              actions={<Button>Novo agendamento</Button>}
            >
              <Conteudo />
            </PainelShell>
          </Quadro>
        ))}
        <Quadro title="Painel do negócio no celular" note="Barra do topo com o menu da conta e navegação flutuante na base; o resto vai em Mais." wide>
          <div className="vt-phone">
            <PainelShell
              embedded
              phone
              testId="vt-painel-celular"
              contentId="vt-painel-celular-c"
              headingLevel={2}
              theme={conta('LEATHER')}
              brand={{ name: CONTA.name, logoUrl: null, symbolUrl: null }}
              nav={NAV_PAINEL}
              user={USUARIO}
              accountActions={acoes}
              title="Início"
            >
              <Conteudo />
            </PainelShell>
          </div>
        </Quadro>
        <Quadro title="Faixa de suporte" note="Fica fixa no topo; a barra começa abaixo dela." wide>
          <PainelShell
            embedded
            testId="vt-painel-suporte"
            contentId="vt-painel-suporte-c"
            headingLevel={2}
            theme={conta('LEATHER')}
            brand={{ name: CONTA.name, logoUrl: null, symbolUrl: null }}
            nav={NAV_PAINEL}
            user={{ name: 'Admin Flui', roleLabel: 'Suporte', avatarUrl: null }}
            supportBanner={`Você está em modo suporte na conta ${CONTA.name}`}
            supportAction={<Button variant="secondary" size="sm">Encerrar</Button>}
            title="Início"
          >
            <Conteudo />
          </PainelShell>
        </Quadro>
        <Quadro title="Painel dev" note="A mesma estrutura no tema noite, com a marca em negativo." wide>
          <DevShell
            embedded
            testId="vt-dev"
            contentId="vt-dev-c"
            headingLevel={2}
            nav={NAV_DEV}
            admin={{ name: 'Admin Flui' }}
            title="Visão geral"
            accountActions={
              <>
                <Button variant="secondary">Meu perfil</Button>
                <Button variant="secondary">Sair</Button>
              </>
            }
          >
            <Conteudo />
          </DevShell>
        </Quadro>
        <Quadro title="Painel dev no celular" wide>
          <div className="vt-phone">
            <DevShell embedded phone testId="vt-dev-celular" contentId="vt-dev-celular-c" headingLevel={2} nav={NAV_CURTA} admin={{ name: 'Admin Flui' }} title="Visão geral">
              <Conteudo />
            </DevShell>
          </div>
        </Quadro>
        <Quadro title="Entrada genérica" note="Bloco de destaque à esquerda e o formulário num cartão que flutua." wide>
          <EntryScreen embedded testId="vt-entrada" theme={deriveTheme(AGENDAFLUI_BRAND)} brand={{ name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }} headline="A agenda que flui." title="Entrar na agenda" message="Use o e-mail e a senha da sua conta.">
            <div className="af-entry__form">
              <Button size="lg">Entrar</Button>
            </div>
          </EntryScreen>
        </Quadro>
        <Quadro title="Entrada de uma conta" note="O nome da conta e a mensagem de entrada ocupam o destaque." wide>
          <EntryScreen embedded testId="vt-entrada-conta" theme={conta('LEATHER')} brand={{ name: CONTA.name, logoUrl: null, symbolUrl: null }} headline="Que bom ver você de volta." lede="Sua agenda está esperando." title="Entrar na agenda">
            <div className="af-entry__form">
              <Button size="lg">Entrar</Button>
            </div>
          </EntryScreen>
        </Quadro>
        <Quadro title="Entrada no celular e do painel dev" wide>
          <div className="vt-row vt-row--top">
            <div className="vt-phone">
              <EntryScreen embedded phone testId="vt-entrada-celular" theme={conta('LEATHER')} brand={{ name: CONTA.name, logoUrl: null, symbolUrl: null }} headline="Que bom ver você de volta." title="Entrar na agenda">
                <div className="af-entry__form">
                  <Button size="lg">Entrar</Button>
                </div>
              </EntryScreen>
            </div>
            <div className="vt-phone">
              <EntryScreen embedded phone variant="dev" testId="vt-entrada-dev" brand={{ name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }} headline="Painel da plataforma" title="Entrar no painel">
                <div className="af-entry__form">
                  <Button size="lg">Entrar</Button>
                </div>
              </EntryScreen>
            </div>
          </div>
        </Quadro>
      </div>
    </section>
  )
}
