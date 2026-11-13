'use client'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  Avatar,
  Button,
  Checkbox,
  Counter,
  DataList,
  Dialog,
  EmptyState,
  Field,
  Input,
  Paper,
  Select,
  Skeleton,
  Stamp,
  Switch,
  Tabs,
  Textarea,
  useToast,
} from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { DAY_END, DAY_START, hhmm } from './demo-data'
import type { Appointment, ClientRow, Scenario } from './demo-data'

const HOUR_REM = 7
const hours = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i)
const rem = (minutes: number) => `${((minutes - DAY_START) / 60) * HOUR_REM}rem`

function Slip({ a }: { a: Appointment }) {
  const tall = a.duration >= 60
  const settled = a.status.tone === 'neutral' || a.status.tone === 'bad'
  return (
    <Paper
      as="li"
      raised={settled ? 1 : 2}
      className="vt-slip"
      style={{ top: `calc(${rem(a.start)} + 3px)`, height: `calc(${(a.duration / 60) * HOUR_REM}rem - 6px)` }}
    >
      <span className="vt-slip__pin" aria-hidden="true" />
      <div className="vt-slip__text">
        <p className="vt-slip__client">{a.client}</p>
        <p className="vt-slip__service">{a.service}</p>
        {tall ? (
          <p className="vt-slip__meta">
            {a.professional}, até {hhmm(a.start + a.duration)}
          </p>
        ) : (
          <span className="af-sr">
            {a.professional}, às {hhmm(a.start)}
          </span>
        )}
      </div>
      <span className="vt-slip__stamp">
        <Stamp tone={a.status.tone}>{a.status.label}</Stamp>
      </span>
    </Paper>
  )
}

function DayPlanner({ scenario }: { scenario: Scenario }) {
  const [who, setWho] = useState('todos')
  const tabs = [{ id: 'todos', label: 'Todos' }, ...scenario.professionals.map((p) => ({ id: p.id, label: p.name }))]
  const person = scenario.professionals.find((p) => p.id === who)
  const shown = scenario.appointments.filter((a) => !person || a.professional === person.name)
  const [dialog, setDialog] = useState(false)
  return (
    <section aria-labelledby="vt-agenda" className="vt-section">
      <h3 id="vt-agenda" className="vt-h3">
        {scenario.dateLabel}
      </h3>
      <Tabs items={tabs} value={who} onChange={setWho} label="Profissional" />
      <Paper className="vt-day" raised={1}>
        {shown.length === 0 ? (
          <div className="vt-day__empty">
            <EmptyState
              title={`${person?.name ?? 'Ninguém'} não tem atendimentos hoje`}
              description="O dia está livre. Marque um horário para esta pessoa."
              action={
                <Button variant="secondary" onClick={() => setDialog(true)}>
                  Marcar atendimento
                </Button>
              }
            />
          </div>
        ) : (
          <div className="vt-day__grid" style={{ height: `${(hours.length - 1) * HOUR_REM}rem` }}>
            {hours.map((h) => (
              <span key={h} className="vt-hour" style={{ top: `${(h - DAY_START / 60) * HOUR_REM}rem` }}>
                {hhmm(h * 60)}
              </span>
            ))}
            <div className="vt-now" style={{ top: rem(scenario.now) }}>
              <span className="vt-now__tag">{hhmm(scenario.now)}</span>
              <span className="af-sr">Agora</span>
            </div>
            <ol className="vt-slips" aria-label="Atendimentos">
              {shown.map((a) => (
                <Slip key={a.id} a={a} />
              ))}
            </ol>
          </div>
        )}
        <p className="vt-day__foot">{scenario.afternoon}</p>
      </Paper>
      <NewAppointment scenario={scenario} open={dialog} onClose={() => setDialog(false)} />
    </section>
  )
}

function NewAppointment({ scenario, open, onClose }: { scenario: Scenario; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [client, setClient] = useState('')
  const [error, setError] = useState<string | null>(null)
  function save(e: FormEvent) {
    e.preventDefault()
    if (!client) {
      setError(`Escolha ${scenario.kind === 'pet' ? 'o tutor' : 'o cliente'} para continuar.`)
      return
    }
    setError(null)
    onClose()
    toast({ tone: 'ok', message: 'Agendamento salvo.' })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Novo agendamento"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="vt-novo" icon={<Save size={18} />}>
            Salvar agendamento
          </Button>
        </>
      }
    >
      <form id="vt-novo" onSubmit={save} className="vt-form" noValidate>
        <Field label={scenario.clientWord.one} error={error}>
          <Select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Escolha na lista</option>
            {scenario.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Serviço">
          <Select defaultValue={scenario.services[0]?.id}>
            {scenario.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="vt-form__pair">
          <Field label="Profissional">
            <Select defaultValue={scenario.professionals[0]?.id}>
              {scenario.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Horário">
            <Input type="time" defaultValue="14:00" />
          </Field>
        </div>
        <Field label="Observações" hint="Alergias, preferências e recados para quem atende.">
          <Textarea rows={3} />
        </Field>
      </form>
    </Dialog>
  )
}

function Counters({ scenario }: { scenario: Scenario }) {
  const [counts, setCounts] = useState(scenario.counters)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  function refresh() {
    setLoading(true)
    timer.current = setTimeout(() => {
      setCounts((c) => ({ today: c.today + 1, revenueCents: c.revenueCents + 6500, occupancy: Math.min(100, c.occupancy + 3) }))
      setLoading(false)
    }, 900)
  }
  return (
    <section aria-labelledby="vt-numeros" className="vt-section">
      <div className="vt-section__head">
        <h3 id="vt-numeros" className="vt-h3">
          Números de hoje
        </h3>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={16} />} loading={loading} onClick={refresh}>
          Atualizar números
        </Button>
      </div>
      {loading ? (
        <Skeleton lines={2} />
      ) : (
        <div className="vt-counters">
          <Counter label="Atendimentos hoje" value={counts.today} digits={2} />
          <Counter label="Faturamento do dia" value={counts.revenueCents} format="brl" digits={6} />
          <Counter label="Ocupação (%)" value={counts.occupancy} digits={2} />
        </div>
      )}
    </section>
  )
}

function ClientList({ scenario }: { scenario: Scenario }) {
  const columns: DataColumn<ClientRow>[] = [
    {
      key: 'nome',
      header: scenario.clientWord.one,
      primary: true,
      cell: (r) => (
        <span className="vt-person">
          <Avatar name={r.name} size="sm" />
          <span className="vt-person__text">
            <span className="vt-person__name">{r.name}</span>
            <span className="vt-person__detail">{r.detail}</span>
          </span>
        </span>
      ),
    },
    { key: 'tel', header: 'Telefone', cell: (r) => r.phone },
    { key: 'visita', header: 'Última visita', cell: (r) => r.lastVisit },
    { key: 'pontos', header: 'Pontos', cell: (r) => r.points },
  ]
  const toast = useToast()
  return (
    <section aria-labelledby="vt-clientes" className="vt-section">
      <h3 id="vt-clientes" className="vt-h3">
        {scenario.clientWord.many} de hoje
      </h3>
      <DataList
        label={`${scenario.clientWord.many} de hoje`}
        columns={columns}
        rows={scenario.clients}
        rowKey={(r) => r.id}
        onRowClick={(r) => toast({ message: `Ficha de ${r.name} aberta.` })}
        empty={<EmptyState title="Nenhum cadastro ainda" />}
      />
    </section>
  )
}

function QuickSignup({ scenario }: { scenario: Scenario }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [whats, setWhats] = useState(true)
  const [club, setClub] = useState(false)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError(`Digite o nome d${scenario.kind === 'pet' ? 'o tutor' : 'o cliente'}.`)
      return
    }
    setError(null)
    toast({ tone: 'ok', message: `${name.trim()} foi cadastrado.` })
    setName('')
  }
  return (
    <section aria-labelledby="vt-cadastro" className="vt-section">
      <h3 id="vt-cadastro" className="vt-h3">
        Cadastro rápido
      </h3>
      <Paper raised={1}>
        <form onSubmit={submit} className="vt-form" noValidate>
          <Field label="Nome completo" error={error}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Telefone" hint="Com DDD. Usamos só para lembretes.">
            <Input type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          <Checkbox checked={whats} onChange={(e) => setWhats(e.target.checked)} label="Enviar lembretes por WhatsApp" />
          <Switch checked={club} onCheckedChange={setClub} label="Participa do clube de pontos" />
          <div>
            <Button variant="primary" type="submit">
              Cadastrar {scenario.clientWord.one.toLowerCase()}
            </Button>
          </div>
        </form>
      </Paper>
    </section>
  )
}

function Keys() {
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <section aria-labelledby="vt-teclas" className="vt-section">
      <h3 id="vt-teclas" className="vt-h3">
        Teclas
      </h3>
      <Paper raised={0} className="vt-keys">
        <div className="vt-keys__row">
          <Button variant="primary">Salvar</Button>
          <Button variant="secondary">Editar</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button variant="danger" icon={<Trash2 size={18} />}>
            Excluir
          </Button>
        </div>
        <div className="vt-keys__row">
          <Button variant="primary" disabled>
            Salvar
          </Button>
          <Button variant="secondary" disabled>
            Editar
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => {
              setBusy(true)
              timer.current = setTimeout(() => setBusy(false), 1400)
            }}
          >
            Enviar lembretes
          </Button>
        </div>
        <div className="vt-keys__row vt-keys__row--sizes">
          <Button size="sm" variant="secondary">
            Pequena
          </Button>
          <Button size="md" variant="secondary">
            Média
          </Button>
          <Button size="lg" variant="primary" icon={<Plus size={20} />}>
            Grande
          </Button>
        </div>
      </Paper>
    </section>
  )
}

/** Uma tela de agenda do dia: o que o painel do negócio mostra de verdade. */
export function DemoAgenda({ scenario }: { scenario: Scenario }) {
  return (
    <div className="vt-demo">
      <Counters key={scenario.kind} scenario={scenario} />
      <DayPlanner scenario={scenario} />
      <ClientList scenario={scenario} />
      <QuickSignup scenario={scenario} />
      <Keys />
    </div>
  )
}

/** Botão do cabeçalho que abre o mesmo diálogo de novo agendamento. */
export function NewAppointmentButton({ scenario }: { scenario: Scenario }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="primary" icon={<Plus size={18} />} onClick={() => setOpen(true)}>
        Novo agendamento
      </Button>
      <NewAppointment scenario={scenario} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
