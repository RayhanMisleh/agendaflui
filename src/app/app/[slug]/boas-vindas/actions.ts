'use server'
import { unstable_rethrow } from 'next/navigation'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { createPet, type PetInput } from '@/server/domain/pets/pets'
import { safeReturnPath } from '@/shared/return-path'
import { atualizarLoja } from '../_lib/revalidar'
import type { SalvarPetResultado } from './quiz'

/*
 * Grava o pet do quiz. Ação é rota pública: `requireCustomer` roda antes de ler o formulário, e quem é dono do pet é sempre o
 * cliente da sessão (um `customerId` que venha no formulário nunca é lido). O domínio valida os campos.
 */

function texto(fd: FormData, nome: string): string {
  const v = fd.get(nome)
  return typeof v === 'string' ? v : ''
}

/** Devolve o caminho com `pet=<id>` (troca o que já houver), para o Agendar abrir no pet recém-criado. */
function comPet(caminho: string, petId: string): string {
  const corte = caminho.indexOf('?')
  const base = corte === -1 ? caminho : caminho.slice(0, corte)
  const q = new URLSearchParams(corte === -1 ? '' : caminho.slice(corte + 1))
  q.set('pet', petId)
  return `${base}?${q.toString()}`
}

export async function salvarPetDoQuiz(slug: string, fd: FormData): Promise<SalvarPetResultado> {
  const visit = await requireCustomer(slug, `/${slug}/boas-vindas`)
  try {
    const species = texto(fd, 'species')
    const nulo = (nome: string): string | null => (texto(fd, nome).trim() === '' ? null : texto(fd, nome))
    const input = {
      name: texto(fd, 'name'),
      species,
      size: nulo('size'),
      breed: texto(fd, 'breed'),
      birthMonth: texto(fd, 'birthMonth'),
      coat: nulo('coat'),
      careNotes: texto(fd, 'careNotes'),
    } as PetInput
    const pet = await createPet(visit.ctx, visit.customerId, input)
    atualizarLoja()
    const volta = safeReturnPath(slug, texto(fd, 'volta'))
    if (texto(fd, 'then') === 'outro') {
      const base = `/${slug}/boas-vindas?novo=1`
      return { ok: true, petId: pet.id, next: volta ? `${base}&volta=${encodeURIComponent(volta)}` : base }
    }
    const vaiParaAgendar = volta !== null && (volta === `/${slug}/agendar` || volta.startsWith(`/${slug}/agendar?`) || volta.startsWith(`/${slug}/agendar/`))
    return { ok: true, petId: pet.id, next: vaiParaAgendar ? comPet(volta, pet.id) : `/${slug}/agendar?pet=${pet.id}` }
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof DomainError) return { ok: false, message: err.message, fields: { ...(err.fields ?? {}) } }
    console.error(JSON.stringify({ level: 'error', event: 'quiz_pet_failed', error: err instanceof Error ? err.name : 'unknown' }))
    return { ok: false, message: MENSAGEM_GENERICA, fields: {} }
  }
}
