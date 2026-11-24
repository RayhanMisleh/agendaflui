import { EMPTY_VALUES, STEPS, firstStepWithError, readValues, stepOfField } from '@/app/dev/(app)/contas/nova/fields'

test('são cinco etapas, na ordem do desenho', () => {
  expect(STEPS.map((s) => s.id)).toEqual(['dados', 'marca', 'modulos', 'regras', 'dono'])
})

test('cada campo pertence a uma etapa; slug é da etapa 1 e o e-mail do dono da 5', () => {
  expect(stepOfField('slug')).toBe(0)
  expect(stepOfField('primary')).toBe(1)
  expect(stepOfField('professionalSingular')).toBeNull()
  expect(stepOfField('store')).toBe(2)
  expect(stepOfField('slotStepMin')).toBe(3)
  expect(stepOfField('ownerEmail')).toBe(4)
  expect(stepOfField('keyName')).toBeNull()
})

test('campos do domínio com nome diferente caem na etapa certa (owner.email)', () => {
  expect(stepOfField('owner.email')).toBe(4)
  expect(stepOfField('owner.name')).toBe(4)
  expect(stepOfField('timeZone')).toBeNull()
})

test('firstStepWithError devolve a primeira etapa com erro, pela ordem das etapas e não dos campos', () => {
  expect(firstStepWithError({ ownerEmail: 'x', slug: 'y' })).toBe(0)
  expect(firstStepWithError({ ownerName: 'x', store: 'y' })).toBe(2)
  expect(firstStepWithError({})).toBeNull()
  expect(firstStepWithError({ campoDesconhecido: 'x' })).toBeNull()
})

test('readValues lê o formulário: texto, caixas marcadas e valores que faltam', () => {
  const fd = new FormData()
  fd.set('name', '  Pata Viva ')
  fd.set('loyalty', 'on')
  fd.set('store', 'on')
  const v = readValues(fd)
  expect(v.name).toBe('  Pata Viva ')
  expect(v.loyalty).toBe(true)
  expect(v.banners).toBe(false)
  expect(v.slug).toBe('')
  expect(v.slotStepMin).toBe(EMPTY_VALUES.slotStepMin)
})
