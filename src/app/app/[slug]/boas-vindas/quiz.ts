import type { PetCoat, PetSize, PetSpecies } from '@/server/db/generated/client'
import type { PetInput } from '@/server/domain/pets/pets'
import { NICHES, type QuizStepKey } from '@/server/niches'

/*
 * Máquina do quiz do pet: funções puras, sem React. Uma pergunta por tela; os passos vêm de `NICHES.PET.quiz` (a pergunta de
 * espécie só existe em loja que atende gatos; gato não tem porte). Quem desenha (`QuizPet`) só despacha ações.
 */

export type { QuizStepKey }

export type QuizAnswers = {
  name: string
  species: PetSpecies
  size: PetSize | null
  breed: string | null
  ageYears: number | null
  coat: PetCoat | null
  careChips: string[]
  careText: string
  photo: File | null
}

export type QuizState = {
  steps: QuizStepKey[]
  index: number
  direction: 1 | -1
  answers: QuizAnswers
  error: string | null
  /** Até onde a pessoa já chegou: "Mudar" no resumo só leva a passo visitado. */
  furthest: number
  /** Veio do resumo para corrigir uma resposta: depois de corrigir, volta ao resumo. */
  review: boolean
}

export type QuizAction =
  | { type: 'set'; patch: Partial<QuizAnswers> }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  | { type: 'goto'; step: QuizStepKey }
  | { type: 'restart' }

/** O resultado de gravar o pet pela ação de servidor do quiz. */
export type SalvarPetResultado =
  | { ok: true; petId: string; next: string }
  | { ok: false; message: string; fields: Record<string, string> }

const QUIZ = NICHES.PET.quiz

export function quizSteps(servesCats: boolean, species: PetSpecies): QuizStepKey[] {
  return QUIZ.filter((s) => (s.onlyIf === 'servesCats' ? servesCats : true))
    .filter((s) => !(s.key === 'size' && species === 'CAT'))
    .map((s) => s.key)
}

export function quizStepDef(key: QuizStepKey) {
  const def = QUIZ.find((s) => s.key === key)
  if (!def) throw new Error(`Passo do quiz desconhecido: ${key}`)
  return def
}

const RESPOSTAS_VAZIAS: QuizAnswers = {
  name: '',
  species: 'DOG',
  size: null,
  breed: null,
  ageYears: null,
  coat: null,
  careChips: [],
  careText: '',
  photo: null,
}

export function initialQuiz(servesCats: boolean): QuizState {
  return {
    steps: quizSteps(servesCats, 'DOG'),
    index: 0,
    direction: 1,
    answers: { ...RESPOSTAS_VAZIAS, careChips: [] },
    error: null,
    furthest: 0,
    review: false,
  }
}

export function stepError(step: QuizStepKey, a: QuizAnswers): string | null {
  if (step === 'name') {
    const nome = a.name.trim()
    if (nome === '') return 'Escreva o nome do pet.'
    if (nome.length > 40) return 'Use até 40 caracteres.'
  }
  if (step === 'size' && a.species === 'DOG' && a.size === null) return 'Escolha o porte.'
  return null
}

function limpar(step: QuizStepKey, a: QuizAnswers): QuizAnswers {
  switch (step) {
    case 'breed':
      return { ...a, breed: null }
    case 'age':
      return { ...a, ageYears: null }
    case 'coat':
      return { ...a, coat: null }
    case 'care':
      return { ...a, careChips: [], careText: '' }
    case 'photo':
      return { ...a, photo: null }
    default:
      return a
  }
}

/** O primeiro passo obrigatório ainda sem resposta (depois de trocar a espécie no resumo), ou o resumo. */
function proximoDaRevisao(steps: QuizStepKey[], a: QuizAnswers): number {
  const pendente = steps.findIndex((k) => stepError(k, a) !== null)
  return pendente === -1 ? steps.length - 1 : pendente
}

function ir(s: QuizState, index: number, direction: 1 | -1, review: boolean): QuizState {
  return { ...s, index, direction, error: null, review, furthest: Math.max(s.furthest, index) }
}

export function quizReducer(s: QuizState, a: QuizAction): QuizState {
  const atual = s.steps[s.index]
  if (atual === undefined) return s
  const ultimo = s.steps.length - 1
  switch (a.type) {
    case 'set': {
      const answers = { ...s.answers, ...a.patch }
      if (answers.species === 'CAT') answers.size = null
      if (answers.species === s.answers.species) return { ...s, answers, error: null }
      // Trocar a espécie recalcula os passos e mantém a pessoa no passo em que está.
      const servesCats = s.steps.includes('species')
      const steps = quizSteps(servesCats, answers.species)
      const index = Math.max(0, steps.indexOf(atual))
      return { ...s, steps, index, answers, error: null, furthest: Math.min(s.furthest, steps.length - 1) }
    }
    case 'next': {
      const erro = stepError(atual, s.answers)
      if (erro) return { ...s, error: erro }
      if (s.index >= ultimo) return s
      if (s.review) return ir(s, proximoDaRevisao(s.steps, s.answers), 1, true)
      return ir(s, s.index + 1, 1, false)
    }
    case 'back': {
      if (s.index === 0) return s
      return ir(s, s.index - 1, -1, false)
    }
    case 'skip': {
      if (!quizStepDef(atual).optional || atual === 'summary') return s
      const answers = limpar(atual, s.answers)
      const base = { ...s, answers }
      if (s.review) return ir(base, proximoDaRevisao(s.steps, answers), 1, true)
      return ir(base, Math.min(s.index + 1, ultimo), 1, false)
    }
    case 'goto': {
      const alvo = s.steps.indexOf(a.step)
      if (alvo === -1 || alvo > s.furthest || alvo === s.index) return s
      return ir(s, alvo, alvo > s.index ? 1 : -1, atual === 'summary' || s.review)
    }
    case 'restart':
      return initialQuiz(s.steps.includes('species'))
  }
}

/** 'AAAA-MM' da data local `today` ('AAAA-MM-DD') menos `ageYears` anos; menos de 1 ano (0) vale 6 meses. */
export function birthMonthFromAge(ageYears: number, today: string): string {
  const ano = Number(today.slice(0, 4))
  const mes = Number(today.slice(5, 7))
  const total = ano * 12 + (mes - 1) - (ageYears <= 0 ? 6 : ageYears * 12)
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

function semPontoFinal(t: string): string {
  return t.trim().replace(/[\s.]+$/, '')
}

/** Cuidados rápidos marcados e o texto livre, juntos com ". ". */
export function careNotesOf(a: Pick<QuizAnswers, 'careChips' | 'careText'>): string | null {
  const partes = [...a.careChips, a.careText].map(semPontoFinal).filter((p) => p !== '')
  return partes.length === 0 ? null : partes.join('. ')
}

export function toPetInput(a: QuizAnswers, today: string): PetInput {
  const raca = a.breed?.trim() ?? ''
  return {
    name: a.name.trim(),
    species: a.species,
    size: a.species === 'CAT' ? null : a.size,
    breed: raca === '' ? null : raca,
    birthMonth: a.ageYears === null ? null : birthMonthFromAge(a.ageYears, today),
    coat: a.coat,
    careNotes: careNotesOf(a),
  }
}

function plano(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Sugestões de raça para o texto digitado (sem acento nem caixa); "Sem raça definida" sempre vem primeiro. */
export function breedMatches(query: string, species: PetSpecies, max = 6): string[] {
  const lista = NICHES.PET.breedSuggestions[species]
  const SEM = 'Sem raça definida'
  const q = plano(query)
  const candidatas = lista.filter((r) => r !== SEM && (q === '' || plano(r).includes(q)))
  // Quem começa com o texto vem antes de quem só o contém.
  const achadas = [...candidatas.filter((r) => plano(r).startsWith(q)), ...candidatas.filter((r) => !plano(r).startsWith(q))]
  return [SEM, ...achadas].slice(0, Math.max(1, max))
}
