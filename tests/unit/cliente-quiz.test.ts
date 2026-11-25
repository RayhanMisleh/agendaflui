import { describe, expect, test } from 'vitest'
import {
  birthMonthFromAge,
  breedMatches,
  initialQuiz,
  quizReducer,
  quizSteps,
  stepError,
  toPetInput,
  type QuizAction,
  type QuizState,
} from '@/app/app/[slug]/(area)/boas-vindas/quiz'

const rodar = (s: QuizState, ...acoes: QuizAction[]) => acoes.reduce(quizReducer, s)
const passo = (s: QuizState) => s.steps[s.index]

describe('quizSteps', () => {
  test('sem gatos: passos name, size, breed, age, coat, care, photo, summary', () => {
    expect(quizSteps(false, 'DOG')).toEqual(['name', 'size', 'breed', 'age', 'coat', 'care', 'photo', 'summary'])
    expect(initialQuiz(false).steps).toHaveLength(8)
  })

  test('com gatos e gato escolhido: sem size e size limpo', () => {
    expect(quizSteps(true, 'DOG')).toContain('species')
    expect(quizSteps(true, 'CAT')).not.toContain('size')
    const s = rodar(
      initialQuiz(true),
      { type: 'set', patch: { name: 'Mel' } },
      { type: 'next' },
      { type: 'set', patch: { species: 'DOG' } },
      { type: 'next' },
      { type: 'set', patch: { size: 'LARGE' } },
      { type: 'back' },
      { type: 'set', patch: { species: 'CAT' } },
    )
    expect(s.answers.size).toBeNull()
    expect(s.steps).not.toContain('size')
    expect(passo(s)).toBe('species')
  })
})

describe('quizReducer', () => {
  test('next sem nome fica no passo com "Escreva o nome do pet."', () => {
    const s = rodar(initialQuiz(false), { type: 'next' })
    expect(passo(s)).toBe('name')
    expect(s.error).toBe('Escreva o nome do pet.')
    expect(stepError('name', { ...s.answers, name: '   ' })).toBe('Escreva o nome do pet.')
  })

  test('cão sem porte não avança do porte', () => {
    const s = rodar(initialQuiz(false), { type: 'set', patch: { name: 'Thor' } }, { type: 'next' }, { type: 'next' })
    expect(passo(s)).toBe('size')
    expect(s.error).toBe('Escolha o porte.')
  })

  test('voltar e avançar mantém todas as respostas', () => {
    const s = rodar(
      initialQuiz(false),
      { type: 'set', patch: { name: 'Thor' } },
      { type: 'next' },
      { type: 'set', patch: { size: 'MEDIUM' } },
      { type: 'next' },
      { type: 'back' },
      { type: 'back' },
    )
    expect(passo(s)).toBe('name')
    expect(s.direction).toBe(-1)
    expect(s.answers).toMatchObject({ name: 'Thor', size: 'MEDIUM' })
    const volta = rodar(s, { type: 'next' })
    expect(volta.direction).toBe(1)
    expect(passo(volta)).toBe('size')
  })

  test('voltar no primeiro passo não faz nada', () => {
    const s = initialQuiz(false)
    expect(quizReducer(s, { type: 'back' })).toBe(s)
  })

  test('skip só em opcional e limpa a resposta', () => {
    const s0 = rodar(initialQuiz(false), { type: 'skip' })
    expect(passo(s0)).toBe('name')
    const noRaca = rodar(
      initialQuiz(false),
      { type: 'set', patch: { name: 'Thor' } },
      { type: 'next' },
      { type: 'set', patch: { size: 'SMALL' } },
      { type: 'next' },
      { type: 'set', patch: { breed: 'Poodle' } },
      { type: 'skip' },
    )
    expect(noRaca.answers.breed).toBeNull()
    expect(passo(noRaca)).toBe('age')
  })

  test('goto do resumo só para passo visitado', () => {
    let s = initialQuiz(false)
    s = rodar(s, { type: 'set', patch: { name: 'Thor' } }, { type: 'next' }, { type: 'set', patch: { size: 'MEDIUM' } }, { type: 'next' })
    expect(quizReducer(s, { type: 'goto', step: 'photo' })).toBe(s)
    for (let i = 0; i < 5; i++) s = rodar(s, { type: 'skip' })
    expect(passo(s)).toBe('summary')
    const mudar = rodar(s, { type: 'goto', step: 'size' })
    expect(passo(mudar)).toBe('size')
    // corrigido o porte, volta direto ao resumo
    expect(passo(rodar(mudar, { type: 'set', patch: { size: 'GIANT' } }, { type: 'next' }))).toBe('summary')
  })

  test('restart volta ao começo sem respostas', () => {
    const s = rodar(initialQuiz(true), { type: 'set', patch: { name: 'Thor' } }, { type: 'next' }, { type: 'restart' })
    expect(passo(s)).toBe('name')
    expect(s.answers.name).toBe('')
    expect(s.steps).toContain('species')
  })
})

describe('toPetInput', () => {
  const base = initialQuiz(false).answers
  test('3 anos em 2026-11-25 → birthMonth 2023-11; menos de 1 ano → 2026-05; cuidados juntos com ". "', () => {
    const tres = toPetInput({ ...base, name: ' Thor ', size: 'MEDIUM', ageYears: 3, careChips: ['Medo de secador', 'Alergia'], careText: 'Não gosta de barulho.' }, '2026-11-25')
    expect(tres).toMatchObject({ name: 'Thor', species: 'DOG', size: 'MEDIUM', birthMonth: '2023-11', careNotes: 'Medo de secador. Alergia. Não gosta de barulho' })
    expect(toPetInput({ ...base, name: 'Bebê', size: 'SMALL', ageYears: 0 }, '2026-11-25').birthMonth).toBe('2026-05')
    expect(birthMonthFromAge(0, '2026-03-10')).toBe('2025-09')
  })

  test('sem respostas opcionais: tudo nulo; gato sem porte', () => {
    expect(toPetInput({ ...base, name: 'Mel', species: 'CAT', size: 'LARGE' }, '2026-11-25')).toEqual({
      name: 'Mel',
      species: 'CAT',
      size: null,
      breed: null,
      birthMonth: null,
      coat: null,
      careNotes: null,
    })
  })
})

describe('breedMatches', () => {
  test('"shi" traz Shih-tzu e "Sem raça definida" primeiro', () => {
    expect(breedMatches('shi', 'DOG').slice(0, 2)).toEqual(['Sem raça definida', 'Shih-tzu'])
  })
  test('sem acento nem caixa, e vazio lista as primeiras', () => {
    expect(breedMatches('MALTES', 'DOG')).toEqual(['Sem raça definida', 'Maltês'])
    expect(breedMatches('', 'CAT', 3)).toHaveLength(3)
    expect(breedMatches('zzz', 'DOG')).toEqual(['Sem raça definida'])
  })
})
