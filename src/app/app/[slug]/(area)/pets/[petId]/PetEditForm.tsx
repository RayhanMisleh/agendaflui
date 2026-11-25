'use client'
import { useState } from 'react'
import { Field, Input, PetTypePicker, Textarea, useToast } from '@/ui/components'
import type { PetTypeValue } from '@/ui/components'
import type { PetCoat, PetSize, PetSpecies } from '@/server/db/generated/client'
import { PET_NICHE } from '@/server/niches/pet'
import { ClienteForm } from '../../../_lib/ClienteForm'
import type { EstadoCliente } from '../../../_lib/estado'
import { editarPet } from '../actions'

export type PetParaEditar = {
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

const PELAGENS = Object.entries(PET_NICHE.coatLabels) as [PetCoat, string][]

/** Todos os campos do pet numa tela só (o quiz pergunta um a um; aqui se muda o que precisar). */
export function PetEditForm({ slug, pet, servesCats }: { slug: string; pet: PetParaEditar; servesCats: boolean }) {
  const avisar = useToast()
  return (
    <ClienteForm
      action={editarPet}
      slug={slug}
      hidden={{ petId: pet.id }}
      submit="Salvar pet"
      onDone={(s) => avisar({ tone: 'success', message: s.message ?? 'Pet salvo.' })}
    >
      {(state) => <Campos pet={pet} servesCats={servesCats} state={state} />}
    </ClienteForm>
  )
}

function Campos({ pet, servesCats, state }: { pet: PetParaEditar; servesCats: boolean; state: EstadoCliente }) {
  const v = state.values
  const [tipo, setTipo] = useState<PetTypeValue>({ species: pet.species, size: pet.size })
  const [nome, setNome] = useState(pet.name)
  const [cuidados, setCuidados] = useState(pet.careNotes ?? '')
  const coat = v.coat ?? pet.coat ?? ''

  function acrescentar(opcao: string) {
    setCuidados((t) => {
      if (t.toLowerCase().includes(opcao.toLowerCase())) return t
      const base = t.replace(/[\s.,;]+$/, '')
      return base === '' ? opcao : `${base}. ${opcao}`
    })
  }

  return (
    <>
      <Field label="Nome" error={state.fields.name}>
        <Input name="name" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoComplete="off" required />
      </Field>
      <div>
        <PetTypePicker name={nome} servesCats={servesCats || pet.species === 'CAT'} staffMayPickCat={false} value={tipo} onChange={setTipo} />
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
      <div className="af-cl-form__pair">
        <Field label="Raça" hint="Opcional." error={state.fields.breed}>
          <Input name="breed" list="cliente-pet-racas" defaultValue={v.breed ?? pet.breed ?? ''} maxLength={60} autoComplete="off" />
        </Field>
        <datalist id="cliente-pet-racas">
          {PET_NICHE.breedSuggestions[tipo.species].map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Field label="Nascimento aproximado" hint="Mês e ano, mais ou menos." error={state.fields.birthMonth}>
          <Input name="birthMonth" type="month" min="1990-01" defaultValue={v.birthMonth ?? pet.birthMonth ?? ''} />
        </Field>
      </div>
      <fieldset className="af-chips__set">
        <legend className="af-field__label">Pelagem</legend>
        <div className="af-chips">
          <label className="af-chip">
            <input type="radio" name="coat" value="" defaultChecked={coat === ''} className="af-chip__input" />
            Não sei
          </label>
          {PELAGENS.map(([chave, rotulo]) => (
            <label key={chave} className="af-chip">
              <input type="radio" name="coat" value={chave} defaultChecked={coat === chave} className="af-chip__input" />
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
      <Field label="Cuidados" hint="A equipe vê antes do atendimento." error={state.fields.careNotes}>
        <Textarea name="careNotes" value={cuidados} onChange={(e) => setCuidados(e.target.value)} maxLength={1000} rows={4} />
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
