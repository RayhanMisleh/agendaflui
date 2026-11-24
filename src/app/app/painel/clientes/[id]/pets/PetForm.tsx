'use client'
import { useState } from 'react'
import { Field, Input, PetTypePicker, Textarea } from '@/ui/components'
import type { PetTypeValue } from '@/ui/components'
import type { PetCoat, PetSize, PetSpecies } from '@/server/db/generated/client'
import { PET_NICHE } from '@/server/niches/pet'
import { PainelForm } from '../../../_lib/PainelForm'
import type { EstadoPainel } from '../../../_lib/PainelForm'
import { criarPet, editarPet } from './actions'

export type PetDados = {
  id: string
  name: string
  species: PetSpecies
  size: PetSize | null
  breed: string | null
  /** 'AAAA-MM' */
  birthMonth: string | null
  coat: PetCoat | null
  careNotes: string | null
}

const ROTULOS = { name: 'Nome', species: 'Espécie', size: 'Porte', breed: 'Raça', birthMonth: 'Nascimento', coat: 'Pelagem', careNotes: 'Cuidados' }
const ANCORAS = { name: 'pet-nome', size: 'pet-porte', breed: 'pet-raca', birthMonth: 'pet-nascimento', careNotes: 'pet-cuidados' }
const PELAGENS = Object.entries(PET_NICHE.coatLabels) as [PetCoat, string][]

/** Cria (sem `pet`) ou edita o pet. Criar leva à página do pet; editar mostra a confirmação aqui mesmo. */
export function PetForm({ customerId, pet, servesCats }: { customerId: string; pet: PetDados | null; servesCats: boolean }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: pet
      ? {
          customerId,
          petId: pet.id,
          name: pet.name,
          species: pet.species,
          size: pet.size ?? '',
          breed: pet.breed ?? '',
          birthMonth: pet.birthMonth ?? '',
          coat: pet.coat ?? '',
          careNotes: pet.careNotes ?? '',
        }
      : { customerId, species: 'DOG' },
  }
  return (
    <PainelForm action={pet ? editarPet : criarPet} initial={inicial} submit={pet ? 'Salvar pet' : 'Adicionar pet'} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => <PetCampos customerId={customerId} petId={pet?.id ?? null} state={state} servesCats={servesCats} />}
    </PainelForm>
  )
}

function PetCampos({ customerId, petId, state, servesCats }: { customerId: string; petId: string | null; state: EstadoPainel; servesCats: boolean }) {
  const v = state.values
  const [tipo, setTipo] = useState<PetTypeValue>({
    species: v.species === 'CAT' ? 'CAT' : 'DOG',
    size: v.species === 'CAT' || v.size === '' || v.size === undefined ? null : (v.size as PetSize),
  })
  const [nome, setNome] = useState(v.name ?? '')
  const [cuidados, setCuidados] = useState(v.careNotes ?? '')
  const racas = PET_NICHE.breedSuggestions[tipo.species]

  function acrescentar(opcao: string) {
    setCuidados((t) => {
      if (t.toLowerCase().includes(opcao.toLowerCase())) return t
      const base = t.replace(/[\s.,;]+$/, '')
      return base === '' ? opcao : `${base}. ${opcao}`
    })
  }

  return (
    <>
      <input type="hidden" name="customerId" value={customerId} />
      {petId ? <input type="hidden" name="petId" value={petId} /> : null}
      <Field label="Nome" error={state.fields.name}>
        <Input id="pet-nome" name="name" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoComplete="off" required />
      </Field>
      <div id="pet-porte">
        <PetTypePicker name={nome} servesCats={servesCats} staffMayPickCat value={tipo} onChange={setTipo} />
        {state.fields.size ? (
          <p role="alert" className="af-field__error">
            {state.fields.size}
          </p>
        ) : null}
        {state.fields.species ? (
          <p role="alert" className="af-field__error">
            {state.fields.species}
          </p>
        ) : null}
      </div>
      <div className="af-formgrid">
        <Field label="Raça" hint="Opcional. Escolha da lista ou escreva." error={state.fields.breed}>
          <Input id="pet-raca" name="breed" list="pet-racas" defaultValue={v.breed ?? ''} maxLength={60} autoComplete="off" />
        </Field>
        <datalist id="pet-racas">
          {racas.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Field label="Nascimento aproximado" hint="Mês e ano, mais ou menos." error={state.fields.birthMonth}>
          <Input id="pet-nascimento" name="birthMonth" type="month" min="1990-01" defaultValue={v.birthMonth ?? ''} />
        </Field>
      </div>
      <fieldset className="af-chips__set">
        <legend className="af-field__label">Pelagem</legend>
        <div className="af-chips">
          <label className="af-chip">
            <input type="radio" name="coat" value="" defaultChecked={(v.coat ?? '') === ''} className="af-chip__input" />
            Não sei
          </label>
          {PELAGENS.map(([chave, rotulo]) => (
            <label key={chave} className="af-chip">
              <input type="radio" name="coat" value={chave} defaultChecked={v.coat === chave} className="af-chip__input" />
              {rotulo}
            </label>
          ))}
        </div>
        {state.fields.coat ? (
          <p role="alert" className="af-field__error">
            {state.fields.coat}
          </p>
        ) : null}
      </fieldset>
      <Field label="Cuidados e comportamento" hint="Só a equipe vê. Medo, alergia, pontos sensíveis." error={state.fields.careNotes}>
        <Textarea id="pet-cuidados" name="careNotes" value={cuidados} onChange={(e) => setCuidados(e.target.value)} maxLength={1000} rows={4} />
      </Field>
      <div className="af-chips" role="group" aria-label="Cuidados rápidos">
        {PET_NICHE.careQuickOptions.map((o) => (
          <button key={o} type="button" className="af-chip" onClick={() => acrescentar(o)}>
            {o}
          </button>
        ))}
      </div>
    </>
  )
}
