import { describe, expect, test } from 'vitest'
import { fluxoReducer, iniciarFluxo, novaChave, podeAvancar, type FluxoAcao, type FluxoEstado } from '@/app/app/[slug]/agendar/fluxo'

const um = [{ id: 'thor', bookable: true }]
const dois = [
  { id: 'thor', bookable: true },
  { id: 'mel', bookable: true },
]
const rodar = (s: FluxoEstado, ...acoes: FluxoAcao[]) => acoes.reduce(fluxoReducer, s)
const novo = (o: Partial<Parameters<typeof iniciarFluxo>[0]> = {}) => iniciarFluxo({ key: 'k1', modo: 'novo', pets: um, ...o })

describe('iniciarFluxo', () => {
  test('um pet agendável: começa em servicos, sem passo de pet', () => {
    const s = novo()
    expect(s.passo).toBe('servicos')
    expect(s.passos).toEqual(['servicos', 'profissional', 'horario', 'confirmar'])
    expect(s.petId).toBe('thor')
  })

  test('dois pets: começa em pet; gato com gatos desligados não conta como agendável', () => {
    expect(novo({ pets: dois }).passo).toBe('pet')
    const s = novo({ pets: [{ id: 'thor', bookable: true }, { id: 'mel', bookable: false }] })
    expect(s.passos[0]).toBe('servicos')
  })

  test('só pets não agendáveis (loja desligou gatos): mantém o passo do pet em vez de ficar sem serviços', () => {
    const s = novo({ pets: [{ id: 'mel', bookable: false }] })
    expect(s.passo).toBe('pet')
    expect(s.passos[0]).toBe('pet')
    expect(s.petId).toBeNull()
  })

  test('pré-seleção de pet vai direto aos serviços; completa começa em horario', () => {
    expect(novo({ pets: dois, petId: 'mel' }).passo).toBe('servicos')
    const s = novo({ pets: dois, petId: 'mel', serviceIds: ['banho'], professionalId: 'ana' })
    expect(s.passo).toBe('horario')
    expect(s).toMatchObject({ petId: 'mel', serviceIds: ['banho'], professionalId: 'ana', professionalChosen: true })
  })

  test('pré-seleção sem profissional para no profissional; pet de outro cliente é ignorado', () => {
    expect(novo({ pets: dois, petId: 'mel', serviceIds: ['banho'] }).passo).toBe('profissional')
    expect(novo({ pets: dois, petId: 'alheio' }).passo).toBe('pet')
  })

  test('remarcar: passos profissional, horario, confirmar', () => {
    const s = iniciarFluxo({ key: 'k', modo: 'remarcar', pets: [] })
    expect(s.passos).toEqual(['profissional', 'horario', 'confirmar'])
    expect(s.passo).toBe('profissional')
  })

  test('um só profissional faz tudo: sem passo de profissional', () => {
    const s = novo({ singleProfessional: true, serviceIds: ['banho'] })
    expect(s.passos).not.toContain('profissional')
    expect(s.passo).toBe('horario')
  })
})

describe('fluxoReducer', () => {
  const completo = () =>
    rodar(novo({ pets: dois, petId: 'thor' }), { type: 'servico', serviceId: 'banho' }, { type: 'profissional', id: 'ana' }, { type: 'dia', date: '2026-11-28' }, { type: 'horario', iso: '2026-11-28T17:00:00.000Z', label: '14:00' })

  test('trocar o pet limpa serviços, profissional e horário', () => {
    const s = rodar(completo(), { type: 'pet', petId: 'mel' })
    expect(s).toMatchObject({ petId: 'mel', serviceIds: [], professionalId: null, professionalChosen: false, date: null, startsAt: null })
  })

  test('mudar serviço limpa profissional e horário; trocar dia limpa só o horário', () => {
    const a = rodar(completo(), { type: 'servico', serviceId: 'tosa' })
    expect(a).toMatchObject({ serviceIds: ['banho', 'tosa'], professionalId: null, professionalChosen: false, startsAt: null, date: '2026-11-28' })
    const b = rodar(completo(), { type: 'dia', date: '2026-11-29' })
    expect(b).toMatchObject({ date: '2026-11-29', startsAt: null, serviceIds: ['banho'], professionalId: 'ana' })
    const c = rodar(completo(), { type: 'profissional', id: null })
    expect(c).toMatchObject({ professionalId: null, professionalChosen: true, startsAt: null, date: '2026-11-28' })
  })

  test('tocar de novo no serviço tira da escolha', () => {
    expect(rodar(novo(), { type: 'servico', serviceId: 'banho' }, { type: 'servico', serviceId: 'banho' }).serviceIds).toEqual([])
  })

  test('ocupado volta ao horário com aviso e sugestões e mantém pet, serviços e profissional', () => {
    const sug = [{ iso: '2026-11-28T17:30:00.000Z', label: '14:30', date: '2026-11-28' }]
    const s = rodar(completo(), { type: 'avancar' }, { type: 'avancar' }, { type: 'ocupado', message: 'Esse horário acabou de ser ocupado. Escolha outro.', sugestoes: sug })
    expect(s.passo).toBe('horario')
    expect(s).toMatchObject({ petId: 'thor', serviceIds: ['banho'], professionalId: 'ana', startsAt: null, aviso: 'Esse horário acabou de ser ocupado. Escolha outro.', sugestoes: sug, direction: -1 })
  })

  test('sugestão de outro dia troca date e startsAt', () => {
    const sug = [{ iso: '2026-11-30T12:00:00.000Z', label: '09:00', date: '2026-11-30' }]
    const s = rodar(completo(), { type: 'ocupado', message: 'x', sugestoes: sug }, { type: 'horario', iso: '2026-11-30T12:00:00.000Z', label: '09:00' })
    expect(s).toMatchObject({ date: '2026-11-30', startsAt: '2026-11-30T12:00:00.000Z', startsLabel: '09:00', aviso: null, sugestoes: [] })
  })

  test('key não muda entre ações', () => {
    expect(completo().key).toBe('k1')
    expect(rodar(completo(), { type: 'pet', petId: 'mel' }, { type: 'avancar' }, { type: 'voltar' }).key).toBe('k1')
  })

  test('podeAvancar falso sem serviço; avancar não passa', () => {
    const s = novo()
    expect(podeAvancar(s)).toBe(false)
    expect(rodar(s, { type: 'avancar' }).passo).toBe('servicos')
    expect(podeAvancar(rodar(s, { type: 'servico', serviceId: 'banho' }))).toBe(true)
  })

  test('avancar, voltar e ir marcam a direção', () => {
    const s = rodar(novo(), { type: 'servico', serviceId: 'banho' }, { type: 'avancar' })
    expect(s).toMatchObject({ passo: 'profissional', direction: 1 })
    expect(rodar(s, { type: 'voltar' })).toMatchObject({ passo: 'servicos', direction: -1 })
    expect(rodar(s, { type: 'voltar' }, { type: 'voltar' }).passo).toBe('servicos')
    expect(rodar(completo(), { type: 'avancar' }, { type: 'avancar' }, { type: 'ir', passo: 'servicos' }).direction).toBe(-1)
  })

  test('profissional único: o passo some e voltar pula por cima dele', () => {
    const s = rodar(novo(), { type: 'servico', serviceId: 'banho' }, { type: 'avancar' }, { type: 'unico', id: 'ana' })
    expect(s).toMatchObject({ passo: 'horario', professionalId: 'ana', professionalChosen: true, semProfissional: true })
    expect(s.passos).not.toContain('profissional')
    expect(rodar(s, { type: 'voltar' }).passo).toBe('servicos')
    // mudar o serviço traz o passo de volta
    expect(rodar(s, { type: 'servico', serviceId: 'tosa' }).passos).toContain('profissional')
  })
})

test('novaChave tem o formato aceito pelo domínio', () => {
  expect(novaChave()).toMatch(/^[A-Za-z0-9_-]{1,80}$/)
})
