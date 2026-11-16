import { describe, expect, test } from 'vitest'
import { renderAccountExists, renderPasswordResetCode, renderRegistrationCode } from '@/server/notifications/render-account'

const brand = { name: 'Barbearia <b>Ouro</b> & "Cia"', color: '#8A2BE2' }

describe('e-mails de conta', () => {
  test('código de cadastro: assunto, texto e HTML em pt-BR com o nome da conta e o código', () => {
    const m = renderRegistrationCode(brand, { customerName: 'Maria', code: '123456', ttlMin: 15 })
    expect(m.subject).toContain('Barbearia <b>Ouro</b> & "Cia"')
    expect(m.subject).toMatch(/c[oó]digo/i)
    expect(m.text).toContain('123456')
    expect(m.text).toContain('15 minutos')
    expect(m.html).toContain('123456')
    expect(m.html).toContain('lang="pt-BR"')
    expect(m.html).toContain('#8A2BE2')
  })

  test('escapa o HTML de tudo que vem de dado (nome da conta e do cliente)', () => {
    const nome = '<script>alert(1)</script>'
    for (const m of [
      renderRegistrationCode(brand, { customerName: nome, code: '123456', ttlMin: 15 }),
      renderPasswordResetCode(brand, { customerName: nome, code: '123456', ttlMin: 15 }),
      renderAccountExists(brand, { customerName: nome }),
    ]) {
      expect(m.html).not.toContain('<script>')
      expect(m.html).not.toContain('<b>Ouro</b>')
      expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(m.html).toContain('Barbearia &lt;b&gt;Ouro&lt;/b&gt; &amp; &quot;Cia&quot;')
    }
  })

  test('sem imagens remotas, sem recursos externos', () => {
    for (const m of [
      renderRegistrationCode(brand, { customerName: 'Maria', code: '123456', ttlMin: 15 }),
      renderPasswordResetCode(brand, { customerName: 'Maria', code: '123456', ttlMin: 15 }),
      renderAccountExists(brand, { customerName: 'Maria' }),
    ]) {
      expect(m.html).not.toMatch(/<img|<link|<script|<iframe|url\(|src=|https?:\/\//i)
    }
  })

  test('o assunto nunca leva quebra de linha; cor inválida cai na cor padrão (sem injetar CSS)', () => {
    const m = renderRegistrationCode(
      { name: 'Conta\r\nBcc: vitima@x.test', color: 'red;}</style><script>' },
      { customerName: 'Maria', code: '123456', ttlMin: 15 },
    )
    expect(m.subject).not.toMatch(/[\r\n]/)
    expect(m.html).not.toContain('</style><script>')
    expect(m.html).not.toContain('red;}')
  })

  test('conta já existe: sem código, orienta a recuperar a senha', () => {
    const m = renderAccountExists(brand, { customerName: 'Maria' })
    expect(m.text).not.toMatch(/\b\d{6}\b/)
    expect(m.text.toLowerCase()).toContain('esqueci')
    expect(m.subject.toLowerCase()).toContain('já')
  })

  test('redefinição: assunto próprio e código', () => {
    const m = renderPasswordResetCode(brand, { customerName: 'Maria', code: '654321', ttlMin: 15 })
    expect(m.subject.toLowerCase()).toContain('senha')
    expect(m.text).toContain('654321')
  })
})
