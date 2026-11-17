import { csvCell, moneyCell } from '@/server/domain/reports/csv'

describe('csvCell', () => {
  test.each([
    ['=SOMA(A1)', "'=SOMA(A1)"],
    ['+55', "'+55"],
    ['-1', "'-1"],
    ['@x', "'@x"],
    ['\tabc', "'\tabc"],
    ['\rabc', "'\rabc"],
  ])('texto %j que começa como fórmula ganha apóstrofo', (entrada, saida) => {
    const out = csvCell(entrada)
    // A célula que tem retorno de carro também vai entre aspas.
    expect(out.replace(/^"|"$/g, '')).toBe(saida)
  })

  test('aspas são dobradas e a célula vai entre aspas', () => {
    expect(csvCell('Ana "Bia" Souza')).toBe('"Ana ""Bia"" Souza"')
  })

  test('ponto e vírgula e quebra de linha pedem aspas', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  test('texto comum, vazio e nulo passam como estão', () => {
    expect(csvCell('Banho e tosa')).toBe('Banho e tosa')
    expect(csvCell('')).toBe('')
    expect(csvCell(null)).toBe('')
  })

  test('número não recebe apóstrofo, nem o negativo', () => {
    expect(csvCell(-1)).toBe('-1')
    expect(csvCell(42)).toBe('42')
  })
})

describe('moneyCell', () => {
  test('centavos viram reais com vírgula e sem símbolo', () => {
    expect(moneyCell(8050)).toBe('80,50')
    expect(moneyCell(5)).toBe('0,05')
    expect(moneyCell(0)).toBe('0,00')
    expect(moneyCell(123456)).toBe('1234,56')
    expect(moneyCell(null)).toBe('')
  })
})
