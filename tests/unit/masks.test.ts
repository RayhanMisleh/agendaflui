import { maskCep, maskDocument, maskPhone } from '@/shared/masks'

describe('maskPhone', () => {
  test.each([
    ['', ''],
    ['1', '(1'],
    ['11', '(11'],
    ['119', '(11) 9'],
    ['1191234', '(11) 9123-4'],
    ['11912345', '(11) 9123-45'],
    ['1112345678', '(11) 1234-5678'],
    ['11912345678', '(11) 91234-5678'],
    ['(11) 91234-5678', '(11) 91234-5678'],
    ['119123456789999', '(11) 91234-5678'],
    ['abc11x', '(11'],
  ])('%j vira %j', (entrada, saida) => {
    expect(maskPhone(entrada)).toBe(saida)
  })

  test('número do Brasil colado com o 55 na frente perde o código do país', () => {
    expect(maskPhone('5511912345678')).toBe('(11) 91234-5678')
    expect(maskPhone('551112345678')).toBe('(11) 1234-5678')
  })

  test('começando com + é número de fora: sem máscara do Brasil, só dígitos e espaços', () => {
    expect(maskPhone('+')).toBe('+')
    expect(maskPhone('+49 151 1234 5678')).toBe('+49 151 1234 5678')
    expect(maskPhone('+49-151 (1234)  5678abc')).toBe('+49151 1234 5678')
    expect(maskPhone('  +1 415 555 0123')).toBe('+1 415 555 0123')
    expect(maskPhone('+ 49')).toBe('+49')
    expect(maskPhone(`+${'1'.repeat(40)}`)).toHaveLength(21)
  })

  test('é idempotente', () => {
    for (const v of ['(11) 91234-5678', '(11) 1234-5678', '+49 151 1234 5678', '(1']) expect(maskPhone(maskPhone(v))).toBe(maskPhone(v))
  })
})

describe('maskDocument', () => {
  test.each([
    ['', ''],
    ['5', '5'],
    ['529', '529'],
    ['5299', '529.9'],
    ['529982', '529.982'],
    ['5299822', '529.982.2'],
    ['52998224725', '529.982.247-25'],
    ['529.982.247-25', '529.982.247-25'],
  ])('CPF: %j vira %j', (entrada, saida) => {
    expect(maskDocument(entrada)).toBe(saida)
  })

  test.each([
    ['529982247250', '52.998.224/7250'],
    ['11222333000181', '11.222.333/0001-81'],
    ['11.222.333/0001-81', '11.222.333/0001-81'],
    ['112223330001819999', '11.222.333/0001-81'],
  ])('CNPJ numérico: %j vira %j', (entrada, saida) => {
    expect(maskDocument(entrada)).toBe(saida)
  })

  test('CNPJ alfanumérico: letras nas 12 primeiras posições, em maiúsculas; dígitos verificadores só números', () => {
    expect(maskDocument('12abc34501de35')).toBe('12.ABC.345/01DE-35')
    expect(maskDocument('12.abc.345/01de-35')).toBe('12.ABC.345/01DE-35')
    expect(maskDocument('12abc34501deAB')).toBe('12.ABC.345/01DE')
    expect(maskDocument('a')).toBe('A')
    expect(maskDocument('ab12')).toBe('AB.12')
  })

  test('é idempotente', () => {
    for (const v of ['529.982.247-25', '12.ABC.345/01DE-35', '11.222.333/0001-81', '52.998']) expect(maskDocument(maskDocument(v))).toBe(maskDocument(v))
  })
})

describe('maskCep', () => {
  test.each([
    ['', ''],
    ['01310', '01310'],
    ['013101', '01310-1'],
    ['01310100', '01310-100'],
    ['01310-100', '01310-100'],
    ['0131010099', '01310-100'],
    ['a0b1', '01'],
  ])('%j vira %j', (entrada, saida) => {
    expect(maskCep(entrada)).toBe(saida)
  })
})
