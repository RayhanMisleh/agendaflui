'use server'
import { redirect } from 'next/navigation'
import { archivePet, createPet, restorePet, updatePet } from '@/server/domain/pets/pets'
import type { PetInput } from '@/server/domain/pets/pets'
import { feito, ler } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../../../_lib/action'
import { atualizarPainel } from '../../../_lib/revalidar'

/*
 * Ações dos pets na ficha do cliente. Escrever pede `manage_clients` (o profissional só lê). O `customerId` e o `petId` vêm
 * em campos escondidos e o domínio só os encontra dentro da conta ativa; quem valida é o domínio.
 */

const CAMPOS = ['customerId', 'petId', 'name', 'species', 'size', 'breed', 'birthMonth', 'coat', 'careNotes'] as const

const lerFormulario = (fd: FormData): Campos => ler(fd, CAMPOS)

/** Os campos do formulário como o domínio os espera (texto vazio vira "não informado"; o domínio valida o resto). */
function entrada(v: Campos): PetInput {
  const nulo = (t: string | undefined): string | null => (t === undefined || t === '' ? null : t)
  return {
    name: v.name ?? '',
    species: (v.species ?? '') as PetInput['species'],
    size: nulo(v.size) as PetInput['size'],
    breed: v.breed ?? '',
    birthMonth: v.birthMonth ?? '',
    coat: nulo(v.coat) as PetInput['coat'],
    careNotes: v.careNotes ?? '',
  }
}

export const criarPet = tenantAction(
  'manage_clients',
  lerFormulario,
  async (ctx, v) => ({ customerId: v.customerId ?? '', pet: await createPet(ctx, v.customerId ?? '', entrada(v)) }),
  ({ customerId, pet }) => {
    atualizarPainel()
    redirect(`/painel/clientes/${customerId}/pets/${pet.id}?novo=1`)
  },
)

export const editarPet = tenantAction(
  'manage_clients',
  lerFormulario,
  async (ctx, v) => {
    await updatePet(ctx, v.petId ?? '', entrada(v))
    atualizarPainel()
    return 'Pet salvo.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarPet = tenantAction(
  'manage_clients',
  (fd) => ler(fd, ['petId']),
  async (ctx, v) => {
    await archivePet(ctx, v.petId ?? '')
    atualizarPainel()
    return 'Pet arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const restaurarPet = tenantAction(
  'manage_clients',
  (fd) => ler(fd, ['petId']),
  async (ctx, v) => {
    await restorePet(ctx, v.petId ?? '')
    atualizarPainel()
    return 'Pet restaurado.'
  },
  (mensagem, v) => feito(mensagem, v),
)
