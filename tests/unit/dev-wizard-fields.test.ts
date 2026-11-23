import { EMPTY_VALUES, STEPS, firstStepWithError, readValues, stepOfField, TERM_PRESETS } from '@/app/dev/(app)/contas/nova/fields'

test('são seis etapas, na ordem do desenho', () => {
  expect(STEPS.map((s) => s.id)).toEqual(['dados', 'marca', 'termos', 'modulos', 'regras', 'dono'])
})

test('cada campo pertence a uma etapa; slug é da etapa 1 e o e-mail do dono da 6', () => {
  expect(stepOfField('slug')).toBe(0)
  expect(stepOfField('primary')).toBe(1)
  expect(stepOfField('professionalSingular')).toBe(2)
  expect(stepOfField('vouchers')).toBe(3)
  expect(stepOfField('slotStepMin')).toBe(4)
  expect(stepOfField('ownerEmail')).toBe(5)
  expect(stepOfField('keyName')).toBeNull()
})

test('campos do domínio com nome diferente caem na etapa certa (owner.email)', () => {
  expect(stepOfField('owner.email')).toBe(5)
  expect(stepOfField('owner.name')).toBe(5)
  expect(stepOfField('timeZone')).toBe(0)
})

test('firstStepWithError devolve a primeira etapa com erro, pela ordem das etapas e não dos campos', () => {
  expect(firstStepWithError({ ownerEmail: 'x', slug: 'y' })).toBe(0)
  expect(firstStepWithError({ ownerName: 'x', club: 'y' })).toBe(2)
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

test('as sugestões por ramo só preenchem termos (nunca marca, dono ou regras)', () => {
  expect(TERM_PRESETS.map((p) => p.label)).toEqual(['Barbearia', 'Pet shop', 'Clínica', 'Estúdio'])
  const pet = TERM_PRESETS.find((p) => p.label === 'Pet shop')!
  expect(pet.terms.professionalSingular).toBe('Tosador')
  expect(pet.terms.customerSingular).toBe('Tutor')
  expect(Object.keys(pet.terms).sort()).toEqual(
    ['club', 'customerPlural', 'customerSingular', 'pointsPlural', 'pointsSingular', 'professionalPlural', 'professionalSingular'],
  )
})
