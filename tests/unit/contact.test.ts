import { formatPhone, normalizeEmail, normalizePhone, searchKey } from '@/server/domain/customers/contact'

test('telefone em formatos soltos vira a mesma forma', () => {
  for (const raw of ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '0055 11 91234 5678', ' 11 9 1234.5678 '])
    expect(normalizePhone(raw)).toBe('5511912345678')
  expect(normalizePhone('(11) 3123-4567')).toBe('551131234567')
  expect(normalizePhone('+351 912 345 678')).toBe('351912345678')
})

test('telefone curto, vazio ou longo demais é recusado com orientação', () => {
  for (const bad of ['', '91234-5678', '123', '1'.repeat(16)]) expect(() => normalizePhone(bad)).toThrow(/DDD/)
})

test('e-mail', () => {
  expect(normalizeEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com')
  for (const bad of ['', 'ana', 'ana@', '@x.com', 'a b@x.com']) expect(() => normalizeEmail(bad)).toThrow(RangeError)
})

test('rótulo de telefone', () => {
  expect(formatPhone('5511912345678')).toBe('(11) 91234-5678')
  expect(formatPhone('551131234567')).toBe('(11) 3123-4567')
  expect(formatPhone('351912345678')).toBe('+351912345678')
})

test('zero de tronco e de operadora são retirados', () => {
  expect(normalizePhone('011 91234-5678')).toBe('5511912345678')
  expect(normalizePhone('0 21 11 91234-5678')).toBe('5511912345678')
  expect(normalizePhone('(011) 3123-4567')).toBe('551131234567')
})

test('letras, 00 duplicado e zero inicial restante são recusados', () => {
  for (const bad of ['+00 55 11 91234-5678', '11 9123A-5678', '0 11 1234']) expect(() => normalizePhone(bad)).toThrow(/DDD/)
})

test('DDD 55 e número que já vem com DDI 55 ficam como estão', () => {
  expect(normalizePhone('(55) 99123-4567')).toBe('5555991234567')
  expect(normalizePhone('55 3123-4567')).toBe('555531234567')
  expect(normalizePhone('5511912345678')).toBe('5511912345678')
  expect(normalizePhone('551131234567')).toBe('551131234567')
})

test('chave de busca sem acento, minúscula e com espaços colapsados', () => {
  expect(searchKey('  JOÃO   da  Conceição ')).toBe('joao da conceicao')
  expect(searchKey('José')).toBe('jose')
})
