'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { Search, UserPlus } from 'lucide-react'
import type { AgendaPage } from '@/server/domain/scheduling/agenda-page'
import { Button, Checkbox, Field, Input, Select, Sheet, Textarea } from '@/ui/components'
import { formatDuration, formatMoney } from '@/ui/format'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { marcarHorario } from './actions'
import { buscarClientes, cadastrarClienteRapido } from './consultas'
import type { ClienteBusca } from './consultas'
import { HorarioFields } from './HorarioFields'

export type Prefill = { professionalId: string; date: string; time: string }
export type TermosAgenda = { customerSingular: string; professionalSingular: string; professionalPlural: string }

const ROTULOS = { customerId: 'Cliente', serviceIds: 'Serviços', professionalId: 'Profissional', date: 'Dia', time: 'Horário', notes: 'Observação' }
const ANCORAS = { customerId: 'marcar-cliente', serviceIds: 'marcar-servicos', date: 'marcar-dia', time: 'marcar-hora' }

/** Busca o cliente pelo nome, telefone ou e-mail; sem resultado, cadastra na hora (nome e telefone). */
function EscolherCliente({ valor, onChange, podeCadastrar, termo, erro }: { valor: ClienteBusca | null; onChange: (c: ClienteBusca | null) => void; podeCadastrar: boolean; termo: string; erro: string | undefined }) {
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ClienteBusca[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [telefone, setTelefone] = useState('')
  const [pendente, comecar] = useTransition()
  const termoBusca = busca.trim()

  useEffect(() => {
    if (termoBusca.length < 2) return
    let vivo = true
    const timer = setTimeout(() => {
      void buscarClientes(termoBusca).then((r) => {
        if (!vivo) return
        if (r.ok) {
          setAchados(r.clientes)
          setAviso(null)
        } else setAviso(r.message)
      })
    }, 250)
    return () => {
      vivo = false
      clearTimeout(timer)
    }
  }, [termoBusca])

  if (valor) {
    return (
      <div className="af-pick">
        <input type="hidden" name="customerId" value={valor.id} />
        <p className="af-pick__chosen">
          <strong>{valor.name}</strong>
          {valor.phoneLabel ? <span> · {valor.phoneLabel}</span> : null}
        </p>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Trocar {termo.toLowerCase()}
        </Button>
      </div>
    )
  }
  const lista = termoBusca.length >= 2 ? achados : null
  return (
    <div className="af-pick">
      <Field label={termo} hint="Busque pelo nome, telefone ou e-mail." error={erro}>
        <Input id="marcar-cliente" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" maxLength={80} />
      </Field>
      {aviso ? (
        <p role="alert" className="af-rowerror">
          {aviso}
        </p>
      ) : null}
      {lista && lista.length > 0 ? (
        <ul className="af-pick__list" aria-label="Resultados">
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" className="af-pick__item" onClick={() => onChange(c)}>
                <Search size={16} aria-hidden="true" />
                <span>{c.name}</span>
                {c.phoneLabel ? <span className="af-pick__muted">{c.phoneLabel}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {lista && lista.length === 0 ? (
        podeCadastrar ? (
          <div className="af-pick__new">
            <p className="af-section__help">
              Ninguém com esse nome. Cadastre {termo.toLowerCase()} agora: só o nome e o telefone.
            </p>
            <Field label="Telefone" hint="Com DDD, por exemplo (11) 91234-5678.">
              <Input type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="off" />
            </Field>
            <Button
              variant="secondary"
              icon={<UserPlus size={16} />}
              loading={pendente}
              onClick={() =>
                comecar(async () => {
                  const r = await cadastrarClienteRapido(termoBusca, telefone)
                  if (r.ok) {
                    onChange(r.cliente)
                    setAviso(null)
                  } else setAviso(r.message)
                })
              }
            >
              Cadastrar {termoBusca}
            </Button>
          </div>
        ) : (
          <p className="af-section__help">Ninguém com esse nome. Peça a quem gerencia para cadastrar.</p>
        )
      ) : null}
    </div>
  )
}

function Formulario({ page, prefill, termos, podeCadastrar, onDone }: { page: AgendaPage; prefill: Prefill; termos: TermosAgenda; podeCadastrar: boolean; onDone: () => void }) {
  const [cliente, setCliente] = useState<ClienteBusca | null>(null)
  const [servicos, setServicos] = useState<string[]>([])
  const [profissional, setProfissional] = useState(prefill.professionalId)
  const [dia, setDia] = useState(prefill.date)
  const [escolhido, setEscolhido] = useState('')
  const [hora, setHora] = useState(prefill.time)

  const duracao = useMemo(() => page.services.filter((s) => servicos.includes(s.id)).reduce((t, s) => t + s.durationMin, 0), [page.services, servicos])

  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { notes: '' } }
  return (
    <PainelForm action={marcarHorario} initial={inicial} submit="Marcar horário" onDone={onDone} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => (
        <>
          <EscolherCliente valor={cliente} onChange={setCliente} podeCadastrar={podeCadastrar} termo={termos.customerSingular} erro={state.fields.customerId} />

          <fieldset className="af-pick">
            <legend className="af-field__label">Serviços</legend>
            {page.services.length === 0 ? <p className="af-section__help">Cadastre um serviço antes de marcar horários.</p> : null}
            {page.services.map((s) => (
              <Checkbox
                key={s.id}
                name="serviceIds"
                value={s.id}
                checked={servicos.includes(s.id)}
                onChange={(e) => setServicos((atuais) => (e.target.checked ? [...atuais, s.id] : atuais.filter((x) => x !== s.id)))}
                label={`${s.name} · ${formatDuration(s.durationMin)} · ${formatMoney(s.priceCents)}`}
              />
            ))}
            {state.fields.serviceIds ? <p className="af-field__error">{state.fields.serviceIds}</p> : null}
            {duracao > 0 ? <p className="af-section__help">Duração total: {formatDuration(duracao)}.</p> : null}
          </fieldset>

          <div className="af-formgrid">
            {page.scope === 'all' ? (
              <Field label={termos.professionalSingular} error={state.fields.professionalId}>
                <Select name="professionalId" value={profissional} onChange={(e) => setProfissional(e.target.value)}>
                  <option value="">Qualquer um que faça</option>
                  {page.professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="professionalId" value={page.ownProfessionalId ?? ''} />
            )}
          </div>

          <HorarioFields
            serviceIds={servicos}
            professionalId={profissional}
            date={dia}
            onDate={setDia}
            time={hora}
            onTime={setHora}
            chosen={escolhido}
            onChosen={setEscolhido}
            prefillTime={prefill.time}
            conflict={state.conflict}
            errors={{ date: state.fields.date, time: state.fields.time }}
            idPrefix="marcar"
          />

          <Field label="Observação" hint="Opcional. Só a equipe vê." error={state.fields.notes}>
            <Textarea name="notes" rows={2} maxLength={2000} defaultValue={state.values.notes ?? ''} />
          </Field>
        </>
      )}
    </PainelForm>
  )
}

/** Marcar horário: cliente por busca ou cadastro rápido, serviços, profissional, dia e horário (os livres vêm do servidor). */
export function BookingSheet({ open, onClose, page, prefill, termos, podeCadastrar }: { open: boolean; onClose: () => void; page: AgendaPage; prefill: Prefill; termos: TermosAgenda; podeCadastrar: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Marcar horário">
      <Formulario page={page} prefill={prefill} termos={termos} podeCadastrar={podeCadastrar} onDone={onClose} />
    </Sheet>
  )
}
