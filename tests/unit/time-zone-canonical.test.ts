import { describe, expect, test } from 'vitest'
import { DomainError } from '@/server/domain/errors'
import { canonicalTimeZone } from '@/server/time'

describe('canonicalTimeZone', () => {
  test('acerta a caixa do identificador', () => {
    expect(canonicalTimeZone('america/sao_paulo')).toBe('America/Sao_Paulo')
    expect(canonicalTimeZone('AMERICA/MANAUS')).toBe('America/Manaus')
    expect(canonicalTimeZone('utc')).toBe('UTC')
  })
  test('mantém o que já está certo e apara espaços', () => {
    expect(canonicalTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo')
    expect(canonicalTimeZone('  America/Recife ')).toBe('America/Recife')
  })
  test('fuso inexistente, vazio ou com deslocamento fixo lança erro de validação no campo timeZone', () => {
    for (const ruim of ['Marte/Olimpo', '', '+03:00', 'America/Sao Paulo']) {
      try {
        canonicalTimeZone(ruim)
        throw new Error(`"${ruim}" deveria falhar`)
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError)
        expect((e as DomainError).code).toBe('validation')
        expect((e as DomainError).fields).toHaveProperty('timeZone')
      }
    }
  })
})
