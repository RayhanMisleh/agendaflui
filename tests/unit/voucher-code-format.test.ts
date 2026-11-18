import { describe, expect, test } from 'vitest'
import { generateVoucherCode, normalizeVoucherCode, VOUCHER_CODE_ALPHABET } from '@/server/domain/vouchers/codes'

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

describe('generateVoucherCode', () => {
  test('o alfabeto não tem símbolos ambíguos e dá entropia de sobra (31^8)', () => {
    expect(VOUCHER_CODE_ALPHABET).toBe(ALFABETO)
    for (const ruim of ['0', 'O', '1', 'I', 'L']) expect(VOUCHER_CODE_ALPHABET).not.toContain(ruim)
    expect(VOUCHER_CODE_ALPHABET.length ** 8).toBeGreaterThan(8e11)
  })

  test('tem o formato XXXX-XXXX e só usa o alfabeto', () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateVoucherCode()
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
      for (const ch of code.replace('-', '')) expect(ALFABETO).toContain(ch)
    }
  })

  test('10.000 códigos gerados não repetem', () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 10_000; i++) vistos.add(generateVoucherCode())
    expect(vistos.size).toBe(10_000)
  })

  test('todos os 31 símbolos aparecem e sem viés grande (cada um perto de 1/31)', () => {
    const contagem = new Map<string, number>()
    const total = 10_000
    for (let i = 0; i < total; i++) for (const ch of generateVoucherCode().replace('-', '')) contagem.set(ch, (contagem.get(ch) ?? 0) + 1)
    expect(contagem.size).toBe(31)
    const esperado = (total * 8) / 31
    for (const n of contagem.values()) {
      expect(n).toBeGreaterThan(esperado * 0.85)
      expect(n).toBeLessThan(esperado * 1.15)
    }
  })

  test('o que sai é aceito pela normalização, sem mudar', () => {
    const code = generateVoucherCode()
    expect(normalizeVoucherCode(code)).toBe(code)
  })
})

describe('normalizeVoucherCode', () => {
  test('aceita minúsculas, espaços nas pontas e sem hífen', () => {
    expect(normalizeVoucherCode(' k7qm4xht ')).toBe('K7QM-4XHT')
    expect(normalizeVoucherCode('k7qm-4xht')).toBe('K7QM-4XHT')
    expect(normalizeVoucherCode('K7QM 4XHT')).toBe('K7QM-4XHT')
    expect(normalizeVoucherCode('k7qm - 4xht')).toBe('K7QM-4XHT')
  })

  test.each(['', '   ', 'K7QM-4XH', 'K7QM-4XHT9', 'K7QM-4XH0', 'K7QM-4XHO', 'K7QM-4XH1', 'K7QMI4XHT', 'L7QM-4XHT', 'K7QM_4XHT', 'K7QM-4XH!', 'К7QM-4XHT', '0'.repeat(8)])('texto inválido %j vira null', (texto) => {
    expect(normalizeVoucherCode(texto)).toBeNull()
  })

  test('valor que não é texto vira null', () => {
    expect(normalizeVoucherCode(undefined as unknown as string)).toBeNull()
    expect(normalizeVoucherCode(123 as unknown as string)).toBeNull()
  })
})
