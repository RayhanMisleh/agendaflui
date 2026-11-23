import { describe, expect, test } from 'vitest'
import { failureSummary, summarize } from '@/server/notifications/scheduler-runs'

describe('summarize', () => {
  test('só contagens conhecidas, com rótulo em português e na ordem em que vêm', () => {
    expect(summarize({ sent: 3, skipped: 1, failed: 0, retried: 2 })).toBe('enviados 3, ignorados 1, falhas 0, novas tentativas 2')
    expect(summarize({ limites: 5, codigos: 0, execucoes: 2, passagens: 4 })).toBe(
      'limites 5, códigos 0, execuções 2, passagens 4',
    )
  })

  test('número solto vira linhas; o que não é contagem conhecida some', () => {
    expect(summarize(4)).toBe('linhas 4')
    expect(summarize({ email: 'maria@exemplo.test', sent: 1, outro: 9, nulo: null, texto: '7' })).toBe('enviados 1')
    for (const v of [undefined, null, 'texto', [], [1, 2], true, {}, Number.NaN, -1, 1.5]) expect(summarize(v)).toBe('')
  })

  test('contagem negativa, não inteira ou grande demais é ignorada', () => {
    expect(summarize({ sent: -1, failed: 2.5, skipped: Number.MAX_SAFE_INTEGER + 1, retried: 1 })).toBe('novas tentativas 1')
  })
})

describe('failureSummary', () => {
  test('só o nome do erro, nunca a mensagem', () => {
    expect(failureSummary(new TypeError('maria@exemplo.test'))).toBe('erro: TypeError')
    expect(failureSummary(new Error('x'))).toBe('erro: Error')
  })

  test('nome estranho ou valor que não é erro viram "desconhecido"', () => {
    expect(failureSummary('maria@exemplo.test')).toBe('erro: desconhecido')
    expect(failureSummary(null)).toBe('erro: desconhecido')
    const ruim = new Error('x')
    ruim.name = 'maria@exemplo.test'
    expect(failureSummary(ruim)).toBe('erro: desconhecido')
  })
})

describe('summarize da retenção', () => {
  test('rotula avisos e auditoria', () => {
    expect(summarize({ avisos: 3, auditoria: 1 })).toBe('avisos 3, auditoria 1')
  })
})
