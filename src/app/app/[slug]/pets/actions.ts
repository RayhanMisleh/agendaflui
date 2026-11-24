'use server'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import { archivePet, getPet, restorePet, updatePet, type PetInput } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { clienteAction } from '../_lib/acao'
import { atualizarLoja } from '../_lib/revalidar'

/*
 * Ações de Meus pets. O cliente vem sempre da sessão (`clienteAction`); o `petId` do formulário nunca é autoridade: o domínio
 * só entrega o pet que é deste cliente (o de outro é "Pet não encontrado."). Quem valida os campos é o domínio.
 */

const CAMPOS = ['petId', 'name', 'species', 'size', 'breed', 'birthMonth', 'coat', 'careNotes'] as const

export const editarPet = clienteAction(
  (fd) => ler(fd, CAMPOS),
  async (v, c) => {
    const nulo = (t: string | undefined): string | null => (t === undefined || t === '' ? null : t)
    const atual = await getPet(v.ctx, c.petId ?? '')
    if (c.species === 'CAT' && atual.species !== 'CAT' && !(await getNicheSettings(v.ctx)).options.servesCats) {
      throw erroDeCampo('species', 'A loja não atende gatos no momento.')
    }
    const input = {
      name: c.name ?? '',
      species: c.species ?? '',
      size: nulo(c.size),
      breed: c.breed ?? '',
      birthMonth: c.birthMonth ?? '',
      coat: nulo(c.coat),
      careNotes: c.careNotes ?? '',
    } as PetInput
    await updatePet(v.ctx, atual.id, input)
    atualizarLoja()
    return 'Pet salvo.'
  },
  (mensagem, c) => feito(mensagem, c),
)

export const arquivarPet = clienteAction(
  (fd) => ler(fd, ['petId']),
  async (v, c) => {
    const pet = await getPet(v.ctx, c.petId ?? '')
    await archivePet(v.ctx, pet.id)
    atualizarLoja()
    return `${pet.name} arquivado.`
  },
  (mensagem, c) => feito(mensagem, c),
)

export const restaurarPet = clienteAction(
  (fd) => ler(fd, ['petId']),
  async (v, c) => {
    const pet = await restorePet(v.ctx, c.petId ?? '')
    atualizarLoja()
    return `${pet.name} voltou para a lista.`
  },
  (mensagem, c) => feito(mensagem, c),
)
