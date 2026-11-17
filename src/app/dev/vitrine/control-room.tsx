'use client'
import { useState } from 'react'
import { Activity, Building2, KeyRound, LayoutDashboard, ScrollText, ShieldCheck } from 'lucide-react'
import { BrandPreview, Button, ColorField, ConfirmDialog, CopyButton, DataList, FormErrors, Gauge, Lamp, MaterialPicker, MiniBars, NavTabs, Pagination, Paper, SearchBar, SecretBox, Sparkline, Stamp, StatTile, StatusLamp, StepRail, describeTrend } from '@/ui/components'
import type { CoverMaterial } from '@/shared/theme/derive'
import type { DataColumn, LampState, Tone } from '@/ui/components'
import { DevShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'

const NAV: NavItem[] = [
  { href: '#visao', label: 'Visão geral', icon: LayoutDashboard, active: true },
  { href: '#contas', label: 'Contas', icon: Building2 },
  { href: '#chaves', label: 'Chaves e API', icon: KeyRound },
  { href: '#sistema', label: 'Sistema', icon: Activity },
  { href: '#auditoria', label: 'Auditoria', icon: ScrollText },
  { href: '#admins', label: 'Admins', icon: ShieldCheck },
]

const SERVICES: Array<{ label: string; state: LampState }> = [
  { label: 'Banco de dados', state: 'on' },
  { label: 'API pública', state: 'on' },
  { label: 'Agendador', state: 'on' },
  { label: 'Envio de e-mail', state: 'warn' },
  { label: 'Frete', state: 'error' },
  { label: 'Mercado Pago', state: 'off' },
]

type Account = { id: string; name: string; status: string; tone: Tone; month: number; access: string }
const ACCOUNTS: Account[] = [
  { id: '1', name: 'Mundo Animal', status: 'Ativa', tone: 'ok', month: 412, access: 'Hoje, 10:12' },
  { id: '2', name: 'Navalha Real', status: 'Ativa', tone: 'ok', month: 286, access: 'Hoje, 09:40' },
  { id: '3', name: 'Clínica Pata Viva', status: 'Suspensa', tone: 'warn', month: 0, access: '2 de nov.' },
  { id: '4', name: 'Studio Íris', status: 'Ativa', tone: 'ok', month: 173, access: 'Ontem, 18:25' },
  { id: '5', name: 'Casa do Tosador', status: 'Arquivada', tone: 'neutral', month: 0, access: '14 de set.' },
]

const COLUMNS: DataColumn<Account>[] = [
  { key: 'conta', header: 'Conta', primary: true, cell: (a) => <strong>{a.name}</strong> },
  { key: 'sit', header: 'Situação', cell: (a) => <Stamp tone={a.tone}>{a.status}</Stamp> },
  { key: 'mes', header: 'Agendamentos no mês', cell: (a) => a.month },
  { key: 'acesso', header: 'Último acesso', cell: (a) => a.access },
]

const ESTADO_VAZIO = { ok: false, message: null, fields: {} as Record<string, string> }
async function acaoDemonstracao() {
  return ESTADO_VAZIO
}

/** As peças das telas do painel dev, na ordem em que aparecem nas listas e nos formulários. */
const ETAPAS = [
  { id: 'dados', label: 'Dados' },
  { id: 'marca', label: 'Marca' },
  { id: 'termos', label: 'Termos' },
  { id: 'modulos', label: 'Módulos' },
  { id: 'regras', label: 'Regras de agenda' },
  { id: 'dono', label: 'Dono' },
  { id: 'chave', label: 'Chave de app' },
]

/** A criação de conta em miniatura: trilho de etapas, cor, material e a prévia ao vivo da marca. */
function CriacaoDeConta() {
  const [etapa, setEtapa] = useState(1)
  const [cor, setCor] = useState('#7A1F2B')
  const [material, setMaterial] = useState<CoverMaterial>('LEATHER')
  return (
    <Paper raised={1} className="vt-accounts">
      <div className="vt-stack">
        <StepRail steps={ETAPAS} current={etapa} onSelect={setEtapa} errorSteps={[4]} visitedUntil={3} />
        <div className="vt-brandgrid">
          <div className="vt-stack">
            <ColorField label="Cor da conta" value={cor} onChange={setCor} />
            <MaterialPicker value={material} onChange={setMaterial} primary={cor} accent="#F2A93B" paper="CREAM" fontPair="CLASSIC" />
          </div>
          <BrandPreview
            businessName="Pata Viva"
            brand={{ primary: cor, accent: '#F2A93B', material, paper: 'CREAM', fontPair: 'CLASSIC' }}
            terms={{ professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores' }}
          />
        </div>
      </div>
    </Paper>
  )
}

function PecasDasTelas() {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <CriacaoDeConta />
      <Paper raised={1} className="vt-accounts">
        <div className="vt-stack">
          <SearchBar
            action="/vitrine"
            label="Buscar contas"
            placeholder="Nome, identificador ou e-mail"
            query="pata"
            filters={[
              {
                name: 'status',
                label: 'Situação',
                value: 'ACTIVE',
                options: [
                  { value: '', label: 'Todas' },
                  { value: 'ACTIVE', label: 'Ativas' },
                  { value: 'SUSPENDED', label: 'Suspensas' },
                ],
              },
            ]}
            clearHref="/vitrine"
          />
          <div className="vt-row">
            <StatusLamp status="ACTIVE" />
            <StatusLamp status="SUSPENDED" />
            <StatusLamp status="ARCHIVED" />
            <CopyButton text="http://painel.exemplo.test/entrar/pata-viva" label="Copiar link de entrada de Pata Viva" />
          </div>
          <FormErrors
            message="Corrija os campos abaixo para criar a conta."
            fields={{ slug: 'Este identificador já está em uso. Escolha outro.' }}
            labels={{ slug: 'Identificador' }}
          />
          <div className="vt-row">
            <Button variant="danger" onClick={() => setAberto(true)}>
              Arquivar conta
            </Button>
          </div>
          <NavTabs
            label="Abas da conta (exemplo)"
            items={[
              { id: 'resumo', label: 'Resumo', href: '/vitrine', exact: true },
              { id: 'marca', label: 'Marca', href: '/vitrine?aba=marca' },
              { id: 'equipe', label: 'Equipe', href: '/vitrine?aba=equipe' },
            ]}
          />
          <SecretBox name="App Pata Viva" secret="afk_a_exemplo_nao_e_uma_chave_de_verdade" />
          <Pagination basePath="/vitrine" params={{ search: 'pata' }} cursor="atual" nextCursor="proximo" />
        </div>
      </Paper>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Arquivar conta"
        description="A conta e a equipe perdem o acesso na hora. Você pode reativá-la depois."
        targetName="Pata Viva"
        confirmLabel="Arquivar conta"
        action={acaoDemonstracao}
        initialState={ESTADO_VAZIO}
      />
    </>
  )
}

/** A mesa de controle: o mesmo conjunto de componentes, em metal. */
export function ControlRoom() {
  return (
    <DevShell
      testId="dev-shell"
      embedded
      headingLevel={2}
      contentId="mesa-conteudo"
      nav={NAV}
      admin={{ name: 'Gabriel Teixeira' }}
      title="Visão geral"
    >
      <div className="vt-demo vt-demo--dev">
        <section aria-labelledby="vt-saude" className="vt-section">
          <h3 id="vt-saude" className="vt-h3">
            Saúde do sistema
          </h3>
          <div className="vt-gauges">
            <Gauge label="Disponibilidade no mês" display="99,9%" value={0.999} />
            <Gauge label="Uso da API" display="64%" value={0.64} />
            <Gauge label="Fila de avisos" display="12 na fila" value={0.12} />
          </div>
        </section>
        <section aria-labelledby="vt-mostradores" className="vt-section">
          <h3 id="vt-mostradores" className="vt-h3">
            Mostradores e gráficos
          </h3>
          <div className="af-bench__panel af-bench__panel--tiles af-glass">
            <StatTile label="Agendamentos no mês" value={1234} digits={4} trend={describeTrend({ current: 20, previousSamePeriod: 8, previous: 30 })}>
              <MiniBars label="Agendamentos" bars={[{ label: 'Mês passado', value: 30 }, { label: 'Mesmo trecho', value: 8 }, { label: 'Este mês', value: 20 }]} />
            </StatTile>
            <StatTile label="Clientes novos" value={5} digits={3} trend={describeTrend({ current: 5, previousSamePeriod: 13, previous: 13 })} />
            <StatTile label="Contas ativas" value={42} digits={3} trend={describeTrend({ current: 7, previousSamePeriod: 7, previous: 9 })}>
              <Sparkline label="Pedidos por dia" values={[3, 5, 2, 8, 6, 9, 7]} />
            </StatTile>
          </div>
        </section>
        <section aria-labelledby="vt-servicos" className="vt-section">
          <h3 id="vt-servicos" className="vt-h3">
            Serviços
          </h3>
          <div className="af-glass vt-lamps">
            {SERVICES.map((s) => (
              <Lamp key={s.label} label={s.label} state={s.state} />
            ))}
          </div>
        </section>
        <section aria-labelledby="vt-contas" className="vt-section">
          <h3 id="vt-contas" className="vt-h3">
            Contas
          </h3>
          <Paper raised={1} className="vt-accounts">
            <DataList label="Contas" columns={COLUMNS} rows={ACCOUNTS} rowKey={(a) => a.id} empty={null} />
          </Paper>
        </section>
        <section aria-labelledby="vt-pecas" className="vt-section">
          <h3 id="vt-pecas" className="vt-h3">
            Peças das telas
          </h3>
          <PecasDasTelas />
        </section>
      </div>
    </DevShell>
  )
}
