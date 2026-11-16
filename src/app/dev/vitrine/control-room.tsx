'use client'
import { useState } from 'react'
import { Activity, Building2, KeyRound, LayoutDashboard, ScrollText, ShieldCheck } from 'lucide-react'
import { Button, ConfirmDialog, CopyButton, DataList, FormErrors, Gauge, Lamp, Pagination, Paper, SearchBar, Stamp, StatusLamp } from '@/ui/components'
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
function PecasDasTelas() {
  const [aberto, setAberto] = useState(false)
  return (
    <>
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
