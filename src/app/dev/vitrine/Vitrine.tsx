'use client'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import {
  Avatar,
  BrandPreview,
  Bubbles,
  Button,
  Card,
  Checkbox,
  ColorField,
  ConfirmDialog,
  CopyButton,
  DataList,
  Dialog,
  EmptyState,
  Field,
  FormErrors,
  Input,
  LinkButton,
  Meter,
  MiniBars,
  NavTabs,
  Pagination,
  SearchBar,
  SecretBox,
  Select,
  SidebarStylePicker,
  Skeleton,
  Sparkline,
  StatNumber,
  StatTile,
  StatusBadge,
  StatusDot,
  StepRail,
  Switch,
  Tabs,
  Textarea,
  TimeChip,
  ToastProvider,
  describeTrend,
  useToast,
} from '@/ui/components'
import type { BadgeTone, DataColumn } from '@/ui/components'
import { ThemeScope } from '@/ui/theme/ThemeScope'
import { deriveTheme } from '@/ui/theme/derive'
import type { CoverMaterial } from '@/ui/theme/derive'
import { DEMO_ACCOUNTS } from './accounts'
import { BrandSection } from './BrandSection'
import { Molduras } from './Molduras'
import './vitrine.css'

function Spec({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'vt-spec vt-spec--wide' : 'vt-spec'}>
      <h3 className="vt-h3">{title}</h3>
      {note ? <p className="vt-note">{note}</p> : null}
      <div className="vt-spec__body">{children}</div>
    </div>
  )
}

const BADGES: ReadonlyArray<{ tone: BadgeTone; text: string }> = [
  { tone: 'confirmed', text: 'Confirmado' },
  { tone: 'pending', text: 'Pendente' },
  { tone: 'done', text: 'Concluído' },
  { tone: 'canceled', text: 'Cancelado' },
  { tone: 'no-show', text: 'Faltou' },
  { tone: 'neutral', text: 'Arquivado' },
]

type Cliente = { id: string; nome: string; pet: string; fone: string; ultima: string }
const CLIENTES: Cliente[] = [
  { id: '1', nome: 'Beatriz Almeida', pet: 'Thor, labrador', fone: '(11) 98421-7733', ultima: '13 de nov.' },
  { id: '2', nome: 'Carlos Nogueira', pet: 'Mel, shih-tzu', fone: '(11) 97755-2086', ultima: '30 de out.' },
  { id: '3', nome: 'Juliana Prado', pet: 'Pipoca, poodle', fone: '(11) 99312-4410', ultima: '6 de nov.' },
]
const COLUNAS: DataColumn<Cliente>[] = [
  { key: 'nome', header: 'Cliente', primary: true, cell: (c) => <strong>{c.nome}</strong> },
  { key: 'pet', header: 'Pet', cell: (c) => c.pet },
  { key: 'fone', header: 'Telefone', nowrap: true, cell: (c) => c.fone },
  { key: 'ultima', header: 'Última visita', nowrap: true, align: 'end', cell: (c) => c.ultima },
]

const HORARIOS: ReadonlyArray<{ time: string; busy?: true }> = [
  { time: '09:00' },
  { time: '09:30', busy: true },
  { time: '10:00' },
  { time: '10:30' },
  { time: '11:00', busy: true },
  { time: '14:00' },
]

const ETAPAS = [
  { id: 'dados', label: 'Dados' },
  { id: 'marca', label: 'Marca' },
  { id: 'termos', label: 'Termos' },
  { id: 'chave', label: 'Chave' },
]

async function confirmarDeMentira(): Promise<{ ok: boolean; message: string | null; fields: Record<string, string> }> {
  return { ok: true, message: null, fields: {} }
}

function Avisos() {
  const toast = useToast()
  return (
    <div className="vt-row">
      <Button onClick={() => toast({ tone: 'success', message: 'Banho agendado para as 10:00.' })}>Sucesso</Button>
      <Button onClick={() => toast({ tone: 'warning', message: 'Esse horário já tem outro banho.' })}>Atenção</Button>
      <Button onClick={() => toast({ tone: 'danger', message: 'Não foi possível salvar. Tente de novo.' })}>Erro</Button>
      <Button onClick={() => toast({ message: 'Lembrete enviado ao tutor.' })}>Neutro</Button>
    </div>
  )
}

function Componentes({ account }: { account: (typeof DEMO_ACCOUNTS)[number] }) {
  const [sw, setSw] = useState(true)
  const [chk, setChk] = useState(true)
  const [hora, setHora] = useState<string | null>('10:00')
  const [aba, setAba] = useState('agenda')
  const [dialogo, setDialogo] = useState(false)
  const [confirma, setConfirma] = useState(false)
  const [etapa, setEtapa] = useState(1)
  const [cor, setCor] = useState(account.brand.primary)
  const [barra, setBarra] = useState<CoverMaterial>(account.brand.material)
  const [carregando, setCarregando] = useState(false)

  return (
    <>
      <section aria-labelledby="vt-botoes" className="vt-section">
        <h2 id="vt-botoes" className="af-h2 vt-h2">
          Ações
        </h2>
        <div className="vt-specs">
          <Spec title="Botão" note="Pílula de 36, 44 e 52 px. O caramelo é para a única ação festiva de uma tela.">
            <div className="vt-row">
              <Button variant="primary">Agendar banho</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="ghost">Ver detalhes</Button>
              <Button variant="danger">Cancelar agendamento</Button>
              <Button variant="accent">Confirmar 10:00</Button>
            </div>
            <div className="vt-row">
              <Button variant="primary" size="sm">
                Pequeno
              </Button>
              <Button variant="primary">Médio</Button>
              <Button variant="primary" size="lg">
                Grande
              </Button>
              <Button variant="primary" icon={<Plus size={18} />}>
                Novo agendamento
              </Button>
            </div>
            <div className="vt-row">
              <Button variant="primary" disabled>
                Desabilitado
              </Button>
              <Button variant="secondary" disabled>
                Desabilitado
              </Button>
              <Button variant="primary" loading={carregando} onClick={() => {
                setCarregando(true)
                setTimeout(() => setCarregando(false), 2000)
              }}>
                Salvar
              </Button>
              <LinkButton href="/dev/vitrine" variant="primary">
                Link como botão
              </LinkButton>
              <CopyButton text="agendaflui.com.br/seupetshop" label="Copiar o link" />
            </div>
          </Spec>
          <Spec title="Horários" note="Livre, escolhido e ocupado. O ocupado diz isso em texto.">
            <div className="vt-chips">
              {HORARIOS.map((h) => (
                <TimeChip key={h.time} time={h.time} state={h.busy ? 'busy' : hora === h.time ? 'selected' : 'free'} onSelect={setHora} />
              ))}
            </div>
            <Button variant="primary" disabled={!hora}>
              {hora ? `Confirmar ${hora}` : 'Escolha um horário'}
            </Button>
          </Spec>
        </div>
      </section>

      <section aria-labelledby="vt-campos" className="vt-section">
        <h2 id="vt-campos" className="af-h2 vt-h2">
          Campos
        </h2>
        <div className="vt-specs">
          <Spec title="Texto">
            <Field label="Nome do pet shop" hint="Aparece no link e nos lembretes.">
              <Input id="vt-nome" placeholder="Ex.: Banho & Cia" />
            </Field>
            <Field label="WhatsApp" error="Use o DDD e o número, com 11 dígitos.">
              <Input defaultValue="(41) 9999" />
            </Field>
            <Field label="Bloqueado">
              <Input disabled defaultValue="Só leitura" />
            </Field>
            <Field label="Observações">
              <Textarea placeholder="Alergias, cuidados, preferências." />
            </Field>
          </Spec>
          <Spec title="Escolha">
            <Field label="Serviço">
              <Select defaultValue="banho">
                <option value="banho">Banho + hidratação</option>
                <option value="tosa">Banho + tosa higiênica</option>
              </Select>
            </Field>
            <SearchBar
              action="/dev/vitrine"
              label="Buscar clientes"
              query=""
              filters={[{ name: 'status', label: 'Situação', value: '', options: [{ value: '', label: 'Todas' }, { value: 'ACTIVE', label: 'Ativas' }] }]}
              clearHref="/dev/vitrine"
              placeholder="Nome, pet ou telefone"
            />
            <Checkbox label="Avisar o tutor quando o pet estiver pronto" checked={chk} onChange={(e) => setChk(e.target.checked)} />
            <Checkbox label="Opção desabilitada" disabled />
            <Switch checked={sw} onCheckedChange={setSw} label="Lembrete no WhatsApp na véspera" />
            <Switch checked={false} disabled onCheckedChange={() => {}} label="Fidelidade (em breve)" />
          </Spec>
          <Spec title="Cor e barra lateral" note="A conta escolhe a cor dela no lugar da Água. A barra tem quatro estilos.">
            <ColorField label="Cor da conta" value={cor} onChange={setCor} />
            <SidebarStylePicker value={barra} onChange={setBarra} primary={account.brand.primary} accent={account.brand.accent} paper={account.brand.paper} fontPair={account.brand.fontPair} />
          </Spec>
        </div>
      </section>

      <section aria-labelledby="vt-superficies" className="vt-section">
        <h2 id="vt-superficies" className="af-h2 vt-h2">
          Superfícies
        </h2>
        <div className="vt-specs">
          <Spec title="Cartões" note="Borda fina e nenhuma sombra. Só o que flutua tem sombra.">
            <Card>
              <strong>Cartão</strong>
              <p className="vt-note">Superfície com borda fina.</p>
            </Card>
            <div className="vt-row vt-row--grow">
              <Card variant="tint">
                <strong>Bolha</strong>
                <p className="vt-note">Destaque suave.</p>
              </Card>
              <Card variant="warm">
                <strong>Mel</strong>
                <p className="vt-note">Lembrete amigável.</p>
              </Card>
            </div>
            <Card variant="block" bubbles>
              <p className="af-h2 vt-on-block">Hoje · terça, 17</p>
              <p className="vt-on-block-note">9 pets agendados, 2 horários livres.</p>
              <Card className="vt-next">
                <StatusBadge tone="confirmed">Confirmado</StatusBadge>
                <strong>10:30 · Thor, banho + hidratação</strong>
              </Card>
            </Card>
          </Spec>
          <Spec title="Bolhas" note="O grafismo da marca. Poucas, nas bordas, nunca atrás de texto corrido.">
            <div className="vt-bubbles">
              <div className="vt-bubbles__box vt-bubbles__box--brand">
                <Bubbles on="brand" count={4} />
              </div>
              <div className="vt-bubbles__box vt-bubbles__box--surface">
                <Bubbles on="surface" count={3} />
              </div>
            </div>
          </Spec>
          <Spec title="Diálogo e aviso" note="O diálogo sobe da base no celular. O aviso é um cartão que flutua.">
            <div className="vt-row">
              <Button onClick={() => setDialogo(true)}>Abrir diálogo</Button>
              <Button variant="danger" onClick={() => setConfirma(true)}>
                Confirmar exclusão
              </Button>
            </div>
            <Avisos />
            <Dialog
              open={dialogo}
              onClose={() => setDialogo(false)}
              title="Novo agendamento"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setDialogo(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={() => setDialogo(false)}>
                    Agendar banho
                  </Button>
                </>
              }
            >
              <Field label="Cliente">
                <Input placeholder="Nome do tutor ou do pet" />
              </Field>
            </Dialog>
            <ConfirmDialog
              open={confirma}
              onClose={() => setConfirma(false)}
              title="Excluir o cliente?"
              description="Os agendamentos dele continuam na agenda."
              action={confirmarDeMentira}
              initialState={{ ok: false, message: null, fields: {} }}
              confirmLabel="Excluir cliente"
              targetName="Beatriz Almeida"
            />
          </Spec>
          <Spec title="Vazio, erro e espera">
            <EmptyState title="Nenhum cliente ainda" description="Cadastre o primeiro para marcar o primeiro banho." action={<Button variant="primary">Novo cliente</Button>} />
            <FormErrors message="Corrija os campos abaixo para continuar." fields={{ nome: 'Informe o nome.', whatsapp: 'Use o DDD e o número.' }} labels={{ nome: 'Nome do pet shop', whatsapp: 'WhatsApp' }} anchors={{ nome: 'vt-nome' }} />
            <Skeleton lines={3} />
            <SecretBox name="Chave do aplicativo" secret="afk_live_3f9a1c7d52b84e60a1d7c9e4" />
            <div className="vt-row">
              <Avatar name="Marina Lopes" size="sm" />
              <Avatar name="Marina Lopes" />
              <Avatar name="Wellington Cruz" size="lg" />
            </div>
          </Spec>
        </div>
      </section>

      <section aria-labelledby="vt-dados" className="vt-section">
        <h2 id="vt-dados" className="af-h2 vt-h2">
          Situação e números
        </h2>
        <div className="vt-specs">
          <Spec title="Selos e pontos" note="Sempre um ponto e o texto: a cor nunca é a única pista.">
            <div className="vt-row">
              {BADGES.map((b) => (
                <StatusBadge key={b.tone} tone={b.tone}>
                  {b.text}
                </StatusBadge>
              ))}
            </div>
            <div className="vt-row">
              <StatusDot tone="success" label="API do aplicativo" detail="Funcionando" />
              <StatusDot tone="warning" label="Fila de avisos" detail="Atenção" />
              <StatusDot tone="danger" label="Envio de e-mail" detail="Com falha" />
              <StatusDot tone="neutral" label="Conta" detail="Arquivada" />
            </div>
          </Spec>
          <Spec title="Números">
            <div className="vt-row vt-row--grow">
              <StatNumber label="Agendamentos hoje" value={12} />
              <StatNumber label="Receita do mês" value={128000} format="brl" size="md" />
            </div>
            <div className="vt-row vt-row--grow">
              <StatTile label="Agendamentos no mês" value={1234} trend={describeTrend({ current: 20, previousSamePeriod: 8, previous: 30 })}>
                <Sparkline label="Agendamentos por dia" values={[3, 5, 2, 8, 6, 9, 7]} />
              </StatTile>
              <StatTile label="Clientes novos" value={5} size="md" trend={describeTrend({ current: 5, previousSamePeriod: 13, previous: 13 })}>
                <MiniBars label="Clientes novos" bars={[{ label: 'Mês passado', value: 13 }, { label: 'Este mês', value: 5 }]} />
              </StatTile>
            </div>
            <Meter label="Requisições sem erro" value={0.98} display="98%" />
            <Meter label="Uso do plano" value={0.86} alertAt={0.8} display="86%" />
          </Spec>
        </div>
      </section>

      <section aria-labelledby="vt-listas" className="vt-section">
        <h2 id="vt-listas" className="af-h2 vt-h2">
          Listas e navegação
        </h2>
        <div className="vt-specs">
          <Spec title="Abas" wide>
            <Tabs
              label="Seções da conta"
              value={aba}
              onChange={setAba}
              items={[
                { id: 'agenda', label: 'Agenda' },
                { id: 'clientes', label: 'Clientes' },
                { id: 'equipe', label: 'Equipe' },
                { id: 'servicos', label: 'Serviços' },
                { id: 'relatorios', label: 'Relatórios' },
                { id: 'config', label: 'Configurações' },
              ]}
            />
            <NavTabs label="Navegação por rotas" items={[{ id: 'a', label: 'Resumo', href: '/dev/vitrine', exact: true }, { id: 'b', label: 'Outra rota', href: '/dev/vitrine?aba=2' }]} />
          </Spec>
          <Spec title="Lista" note="Tabela dentro de um cartão; em largura estreita vira cartões empilhados." wide>
            <Card>
              <DataList columns={COLUNAS} rows={CLIENTES} rowKey={(c) => c.id} onRowClick={() => {}} empty={null} label="Clientes de exemplo" />
              <Pagination basePath="/dev/vitrine" params={{}} cursor="a" nextCursor="b" summary="3 clientes nesta página" />
            </Card>
          </Spec>
          <Spec title="Etapas" wide>
            <StepRail steps={ETAPAS} current={etapa} onSelect={setEtapa} errorSteps={[3]} visitedUntil={2} />
          </Spec>
          <Spec title="Prévia do painel" note="A miniatura muda com a conta, a cor e o estilo da barra." wide>
            <BrandPreview
              brand={{ ...account.brand, material: barra, primary: cor && /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : account.brand.primary }}
              terms={{ professionalSingular: 'Banhista', professionalPlural: 'Banhistas', customerSingular: 'Tutor', customerPlural: 'Tutores' }}
              businessName={account.name}
            />
          </Spec>
        </div>
      </section>
    </>
  )
}

export function Vitrine() {
  const [accountId, setAccountId] = useState(DEMO_ACCOUNTS[0]!.id)
  const [scheme, setScheme] = useState<'day' | 'night'>('day')
  const account = DEMO_ACCOUNTS.find((a) => a.id === accountId) ?? DEMO_ACCOUNTS[0]!
  const theme = useMemo(() => deriveTheme({ ...account.brand, scheme }), [account, scheme])
  // A noite da própria marca usa exatamente os valores do manual (bloco CSS); as contas derivam a noite da cor delas.
  const exactNight = scheme === 'night' && account.platform === true

  const body = (
    <ToastProvider>
      <a className="af-skip" href="#vitrine">
        Pular para o conteúdo
      </a>
      <main id="vitrine" tabIndex={-1} className="vt-wrap">
        <header className="vt-intro">
          <h1 className="af-h1">Vitrine da marca</h1>
          <p className="vt-lead">Cada componente em todos os estados. Troque a conta e o tema abaixo para ver tudo mudar.</p>
          <div className="vt-controls">
            <div className="vt-control" role="group" aria-label="Tema">
              <Button variant={scheme === 'day' ? 'primary' : 'secondary'} size="sm" aria-pressed={scheme === 'day'} onClick={() => setScheme('day')}>
                Dia
              </Button>
              <Button variant={scheme === 'night' ? 'primary' : 'secondary'} size="sm" aria-pressed={scheme === 'night'} onClick={() => setScheme('night')}>
                Noite
              </Button>
            </div>
            <div className="vt-control" role="group" aria-label="Conta de exemplo">
              {DEMO_ACCOUNTS.map((a) => (
                <Button key={a.id} variant={a.id === accountId ? 'primary' : 'secondary'} size="sm" aria-pressed={a.id === accountId} onClick={() => setAccountId(a.id)}>
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        </header>
        <BrandSection night={scheme === 'night'} />
        <Componentes key={account.id} account={account} />
        <Molduras />
      </main>
    </ToastProvider>
  )

  return exactNight ? (
    <div data-theme="" data-scheme="night" className="vt-page">
      {body}
    </div>
  ) : (
    <ThemeScope theme={theme} className="vt-page">
      {body}
    </ThemeScope>
  )
}

