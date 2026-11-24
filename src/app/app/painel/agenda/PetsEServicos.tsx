'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { KeyboardEvent } from 'react'
import { PawPrint, Plus } from 'lucide-react'
import { Button, Checkbox, Field, Input, PetIllustration, PetTypePicker, Skeleton } from '@/ui/components'
import type { PetTypeValue } from '@/ui/components'
import { formatDuration, formatMoney } from '@/ui/format'
import { adicionarPetRapido, servicosDoPet } from './consultas'
import type { PetResumo, ServicoDoPet } from './consultas'

/**
 * Escolha do pet em cartões de rádio com o desenho do porte, em rolagem horizontal com encaixe (cabe em 360 px). Setas
 * movem a escolha; "Adicionar pet" abre um cadastro curto ali mesmo (nome, espécie e porte).
 */
export function EscolherPet({
  customerId,
  pets,
  valor,
  onChange,
  onAdded,
  servesCats,
  podeAdicionar,
  erro,
}: {
  customerId: string
  pets: PetResumo[]
  valor: PetResumo | null
  onChange: (p: PetResumo) => void
  onAdded: (p: PetResumo) => void
  servesCats: boolean
  podeAdicionar: boolean
  erro?: string | undefined
}) {
  const [adicionando, setAdicionando] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (passo === 0 || pets.length === 0) return
    e.preventDefault()
    const i = Math.max(0, pets.findIndex((p) => p.id === (valor?.id ?? pets[0]?.id)))
    const proximo = pets[(i + passo + pets.length) % pets.length]
    if (!proximo) return
    onChange(proximo)
    raiz.current?.querySelector<HTMLElement>(`[data-pet="${proximo.id}"]`)?.focus()
  }

  return (
    <fieldset className="af-pick">
      <legend className="af-field__label">Pet</legend>
      {pets.length === 0 && !adicionando ? <p className="af-section__help">{podeAdicionar ? 'Este cliente ainda não tem pet. Adicione um para marcar.' : 'Este cliente ainda não tem pet. Peça a quem gerencia os clientes para cadastrar o pet.'}</p> : null}
      {pets.length > 0 ? (
        <div ref={raiz} role="radiogroup" aria-label="Pet do atendimento" className="af-petpick" onKeyDown={aoTeclar}>
          {pets.map((p, i) => {
            const ativo = valor ? valor.id === p.id : i === 0
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                data-pet={p.id}
                aria-checked={valor?.id === p.id}
                tabIndex={ativo ? 0 : -1}
                className="af-pickcard af-petpick__card"
                onClick={() => onChange(p)}
              >
                <span className="af-pickcard__art" aria-hidden="true">
                  <PetIllustration variant={p.variant} size={40} />
                </span>
                <span className="af-pickcard__label">{p.name}</span>
                <span className="af-pickcard__detail">{p.typeLabel}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {erro ? <p className="af-field__error">{erro}</p> : null}
      {podeAdicionar && !adicionando ? (
        <div>
          <Button size="sm" variant="secondary" icon={<Plus size={16} />} onClick={() => setAdicionando(true)}>
            Adicionar pet
          </Button>
        </div>
      ) : null}
      {adicionando ? (
        <NovoPet
          customerId={customerId}
          servesCats={servesCats}
          onCancel={() => setAdicionando(false)}
          onAdded={(p) => {
            setAdicionando(false)
            onAdded(p)
          }}
        />
      ) : null}
    </fieldset>
  )
}

/** Mini formulário do pet: nome, espécie e porte. Não é um <form> (fica dentro do formulário de marcar). */
function NovoPet({ customerId, servesCats, onCancel, onAdded }: { customerId: string; servesCats: boolean; onCancel: () => void; onAdded: (p: PetResumo) => void }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<PetTypeValue>({ species: 'DOG', size: null })
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, comecar] = useTransition()
  return (
    <div className="af-pick__new" role="group" aria-label="Novo pet">
      <Field label="Nome do pet" error={aviso ?? undefined}>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoComplete="off" />
      </Field>
      <PetTypePicker name={nome} servesCats={servesCats} staffMayPickCat value={tipo} onChange={setTipo} />
      <div className="af-pick__actions">
        <Button
          variant="primary"
          size="sm"
          icon={<PawPrint size={16} />}
          loading={pendente}
          onClick={() =>
            comecar(async () => {
              const r = await adicionarPetRapido(customerId, { name: nome, species: tipo.species, size: tipo.size })
              if (r.ok) onAdded(r.pet)
              else setAviso(r.message)
            })
          }
        >
          Salvar pet
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

export type CargaServicos = { chave: string; servicos: ServicoDoPet[]; erro: string | null }

/** Os serviços do pet (preço e tempo do porte). Sem pet não há consulta; trocar de pet volta ao esqueleto. */
export function useServicosDoPet(petId: string | null): { carregando: boolean; servicos: ServicoDoPet[]; erro: string | null; tentarDeNovo: () => void } {
  const [tentativa, setTentativa] = useState(0)
  const [carga, setCarga] = useState<CargaServicos | null>(null)
  const chave = petId === null ? '' : `${petId}:${tentativa}`
  useEffect(() => {
    if (petId === null) return
    let vivo = true
    void servicosDoPet(petId).then((r) => {
      if (vivo) setCarga({ chave, servicos: r.ok ? r.servicos : [], erro: r.ok ? null : r.message })
    })
    return () => {
      vivo = false
    }
  }, [petId, chave])
  const pronta = carga !== null && carga.chave === chave
  return {
    carregando: petId !== null && !pronta,
    servicos: pronta ? carga.servicos : [],
    erro: pronta ? carga.erro : null,
    tentarDeNovo: () => setTentativa((t) => t + 1),
  }
}

/** A lista de serviços com o preço e o tempo do porte; o que a loja não faz para o animal fica desabilitado com o motivo. */
export function ServicosDoPetLista({
  petId,
  marcados,
  onToggle,
  erroDeCampo,
  semPet,
  servicos,
  id = 'marcar-servicos',
}: {
  petId: string | null
  marcados: string[]
  onToggle: (id: string, marcado: boolean) => void
  erroDeCampo?: string | undefined
  semPet: string
  servicos: ReturnType<typeof useServicosDoPet>
  id?: string
}) {
  return (
    <fieldset className="af-pick" id={id}>
      <legend className="af-field__label">Serviços</legend>
      {petId === null ? <p className="af-section__help">{semPet}</p> : null}
      {petId !== null && servicos.carregando ? <Skeleton lines={3} /> : null}
      {petId !== null && !servicos.carregando && servicos.erro ? (
        <div role="alert" className="af-rowerror">
          <p>{servicos.erro}</p>
          <Button size="sm" variant="secondary" onClick={servicos.tentarDeNovo}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
      {petId !== null && !servicos.carregando && !servicos.erro && servicos.servicos.length === 0 ? <p className="af-section__help">Cadastre um serviço antes de marcar horários.</p> : null}
      {petId !== null && !servicos.carregando && !servicos.erro
        ? servicos.servicos.map((s) => (
            <div key={s.id} className="af-petservice">
              <Checkbox
                name="serviceIds"
                value={s.id}
                disabled={!s.offered}
                checked={s.offered && marcados.includes(s.id)}
                onChange={(e) => onToggle(s.id, e.target.checked)}
                label={s.offered && s.priceCents !== null && s.durationMin !== null ? `${s.name} · ${formatDuration(s.durationMin)} · ${formatMoney(s.priceCents)}` : s.name}
              />
              {!s.offered && s.reason ? <p className="af-field__hint">{s.reason}</p> : null}
            </div>
          ))
        : null}
      {erroDeCampo ? <p className="af-field__error">{erroDeCampo}</p> : null}
    </fieldset>
  )
}
