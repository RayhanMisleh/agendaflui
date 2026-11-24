import { duracaoBase, nomeCampoDuracao } from '@/app/app/painel/agenda/duracao-ajuste'

const original = { petId: 'p1', serviceIds: ['s1'] }

describe('duracaoBase', () => {
  test('sem mexer em pet nem serviços, vale a duração guardada mesmo que a tabela tenha mudado', () => {
    expect(duracaoBase({ petId: 'p1', marcados: ['s1'], original, somaViva: 75, totalGuardado: 60 })).toBe(60)
  })
  test('trocando o serviço ou o pet, vale a soma viva', () => {
    expect(duracaoBase({ petId: 'p1', marcados: ['s1', 's2'], original, somaViva: 90, totalGuardado: 60 })).toBe(90)
    expect(duracaoBase({ petId: 'p2', marcados: ['s1'], original, somaViva: 45, totalGuardado: 60 })).toBe(45)
  })
})

describe('nomeCampoDuracao', () => {
  test('só a duração que a equipe editou vai ao servidor; a sugerida não, para o domínio refazer a soma ao trocar pet ou serviço', () => {
    expect(nomeCampoDuracao(true)).toBe('durationMin')
    expect(nomeCampoDuracao(false)).not.toBe('durationMin')
  })
})
