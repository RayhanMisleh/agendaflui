'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { Search, UserPlus } from 'lucide-react'
import type { AgendaPage } from '@/server/domain/scheduling/agenda-page'
import { Button, Checkbox, Field, Input, MinutesField, PetTypePicker, Select, Sheet, Textarea, useToast } from '@/ui/components'
import type { PetTypeValue } from '@/ui/components'
import { formatDuration, formatMoney } from '@/ui/format'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { marcarHorario } from './actions'
import { buscarClientes, cadastrarClienteRapido } from './consultas'
import type { ClienteBusca, PetResumo } from './consultas'
import { ConflitosDialog } from './ConflitosDialog'
import { EscolherPet, ServicosDoPetLista, useServicosDoPet } from './PetsEServicos'
import { HorarioFields } from './HorarioFields'

export type Prefill = { professionalId: string; date: string; time: string }
export type TermosAgenda = { customerSingular: string; professionalSingular: string; professionalPlural: string }

const ROTULOS = { customerId: 'Cliente', petId: 'Pet', durationMin: 'Duração', serviceIds: 'Serviços', professionalId: 'Profissional', date: 'Dia', time: 'Horário', notes: 'Observação' }
const ANCORAS = { customerId: 'marcar-cliente', petId: 'marcar-pet', durationMin: 'marcar-duracao', serviceIds: 'marcar-servicos', date: 'marcar-dia', time: 'marcar-hora' }

/** Busca o cliente pelo nome, telefone ou e-mail; sem resultado, cadastra na hora (nome e telefone). */
function EscolherCliente({ valor, onChange, podeCadastrar, termo, erro, niche }: { valor: ClienteBusca | null; onChange: (c: ClienteBusca | null) => void; podeCadastrar: boolean; termo: string; erro: string | undefined; niche: { servesCats: boolean } | null }) {
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ClienteBusca[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [telefone, setTelefone] = useState('')
  const [nomePet, setNomePet] = useState('')
  const [tipoPet, setTipoPet] = useState<PetTypeValue>({ species: 'DOG', size: null })
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
                {c.pets.length > 0 ? <span className="af-pick__muted">{c.pets.map((p) => p.name).join(', ')}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {lista && lista.length === 0 ? (
        podeCadastrar ? (
          <div className="af-pick__new">
            <p className="af-section__help">
              Ninguém com esse nome. Cadastre {termo.toLowerCase()} agora{niche ? ': nome, telefone e o pet' : ': só o nome e o telefone'}.
            </p>
            <Field label="Telefone" hint="Com DDD, por exemplo (11) 91234-5678.">
              <Input type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="off" />
            </Field>
            {niche ? (
              <>
                <Field label="Nome do pet">
                  <Input value={nomePet} onChange={(e) => setNomePet(e.target.value)} maxLength={60} autoComplete="off" />
                </Field>
                <PetTypePicker name={nomePet} servesCats={niche.servesCats} staffMayPickCat value={tipoPet} onChange={setTipoPet} />
              </>
            ) : null}
            <Button
              variant="secondary"
              icon={<UserPlus size={16} />}
              loading={pendente}
              onClick={() =>
                comecar(async () => {
                  const r = await cadastrarClienteRapido({ nome: termoBusca, telefone, ...(niche ? { pet: { name: nomePet, species: tipoPet.species, size: tipoPet.size } } : {}) })
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
  const toast = useToast()
  const niche = page.niche
  const [cliente, setCliente] = useState<ClienteBusca | null>(null)
  const [pets, setPets] = useState<PetResumo[]>([])
  const [pet, setPet] = useState<PetResumo | null>(null)
  const [servicos, setServicos] = useState<string[]>([])
  const [duracao, setDuracao] = useState('')
  const [editada, setEditada] = useState(false)
  const [profissional, setProfissional] = useState(prefill.professionalId)
  const [dia, setDia] = useState(prefill.date)
  const [escolhido, setEscolhido] = useState('')
  const [hora, setHora] = useState(prefill.time)

  const petId = niche ? (pet?.id ?? null) : null
  const doPet = useServicosDoPet(petId)
  // Os serviços com preço e tempo: do porte do pet (conta pet) ou os da página (sem nicho).
  const opcoes = useMemo(
    () =>
      niche
        ? doPet.servicos.filter((s) => s.offered && s.priceCents !== null && s.durationMin !== null).map((s) => ({ id: s.id, priceCents: s.priceCents ?? 0, durationMin: s.durationMin ?? 0 }))
        : page.services,
    [niche, doPet.servicos, page.services],
  )
  const marcados = useMemo(() => opcoes.filter((s) => servicos.includes(s.id)), [opcoes, servicos])
  const soma = marcados.reduce((t, s) => t + s.durationMin, 0)
  const total = marcados.reduce((t, s) => t + s.priceCents, 0)
  const duracaoValor = editada ? duracao : soma > 0 ? String(soma) : ''
  const duracaoNum = editada && /^\d{1,4}$/.test(duracao) && Number(duracao) >= 5 && Number(duracao) <= 720 ? Number(duracao) : undefined

  function escolherCliente(c: ClienteBusca | null) {
    setCliente(c)
    setPets(c?.pets ?? [])
    setPet(c && c.pets.length === 1 ? (c.pets[0] ?? null) : null)
    setServicos([])
  }
  function escolherPet(p: PetResumo) {
    setPet(p)
    setServicos([])
  }

  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { notes: '' } }
  return (
    <PainelForm
      id="marcar-form"
      action={marcarHorario}
      initial={inicial}
      submit="Marcar horário"
      onDone={(state) => {
        if (state.message) toast({ tone: 'success', message: state.message })
        onDone()
      }}
      labels={ROTULOS}
      anchors={ANCORAS}
      secondary={
        total > 0 || soma > 0 ? (
          <p className="af-booktotal" aria-live="polite">
            Total {formatMoney(total)} · {formatDuration(Number(duracaoValor) > 0 ? Number(duracaoValor) : soma)}
          </p>
        ) : null
      }
    >
      {(state) => (
        <>
          <EscolherCliente valor={cliente} onChange={escolherCliente} podeCadastrar={podeCadastrar} termo={termos.customerSingular} erro={state.fields.customerId} niche={niche} />

          {niche && cliente ? (
            <>
              <input type="hidden" name="petId" value={pet?.id ?? ''} />
              <EscolherPet
                customerId={cliente.id}
                pets={pets}
                valor={pet}
                onChange={escolherPet}
                onAdded={(p) => {
                  setPets((l) => [...l, p])
                  escolherPet(p)
                }}
                servesCats={niche.servesCats}
                podeAdicionar={podeCadastrar}
                erro={state.fields.petId}
              />
            </>
          ) : null}

          {niche ? (
            <ServicosDoPetLista
              petId={petId}
              marcados={servicos}
              onToggle={(id, on) => setServicos((l) => (on ? [...l, id] : l.filter((x) => x !== id)))}
              erroDeCampo={state.fields.serviceIds}
              semPet={cliente ? 'Escolha o pet para ver os serviços.' : 'Escolha o cliente e o pet para ver os serviços.'}
              servicos={doPet}
            />
          ) : (
            <fieldset className="af-pick">
              <legend className="af-field__label">Serviços</legend>
              {page.services.length === 0 ? <p className="af-section__help">Cadastre um serviço antes de marcar horários.</p> : null}
              {page.services.map((s) => (
                <Checkbox
                  key={s.id}
                  name="serviceIds"
                  value={s.id}
                  checked={servicos.includes(s.id)}
                  onChange={(e) => setServicos((l) => (e.target.checked ? [...l, s.id] : l.filter((x) => x !== s.id)))}
                  label={`${s.name} · ${formatDuration(s.durationMin)} · ${formatMoney(s.priceCents)}`}
                />
              ))}
              {state.fields.serviceIds ? <p className="af-field__error">{state.fields.serviceIds}</p> : null}
            </fieldset>
          )}

          {soma > 0 ? (
            <MinutesField
              id="marcar-duracao"
              name="durationMin"
              value={duracaoValor}
              sumMin={soma}
              error={state.fields.durationMin}
              onChange={(v) => {
                if (v.trim() === String(soma)) {
                  setEditada(false)
                  setDuracao('')
                } else {
                  setEditada(true)
                  setDuracao(v)
                }
              }}
            />
          ) : null}

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
            serviceIds={niche && petId === null ? [] : servicos}
            professionalId={profissional}
            {...(petId ? { petId } : {})}
            {...(duracaoNum !== undefined ? { durationMin: duracaoNum } : {})}
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
          <ConflitosDialog formId="marcar-form" confirmation={state.confirmation} confirmLabel="Marcar mesmo assim" />
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
