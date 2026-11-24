import { describe, expect, test } from 'vitest'
import { renderAccountExists, renderSignupCode } from '@/server/notifications/render-account'

const brand = { name: 'Pet <b>Ouro</b> & "Cia"', color: '#8A2BE2' }
const LINK = 'https://app.exemplo.test/pet-ouro/entrar'

describe('e-mails de conta', () => {
  test('código de cadastro: assunto, texto e HTML em pt-BR com o nome da loja e o código', () => {
    const m = renderSignupCode(brand, { name: 'Maria', code: '123456', ttlMin: 15 })
    expect(m.subject).toContain('Pet <b>Ouro</b> & "Cia"')
    expect(m.subject).toMatch(/c[oó]digo/i)
    expect(m.text).toContain('123456')
    expect(m.text).toContain('15 minutos')
    expect(m.html).toContain('123456')
    expect(m.html).toContain('lang="pt-BR"')
    expect(m.html).toContain('#8A2BE2')
  })

  test('escapa o HTML de tudo que vem de dado (nome da loja e da pessoa)', () => {
    const nome = '<script>alert(1)</script>'
    for (const m of [renderSignupCode(brand, { name: nome, code: '123456', ttlMin: 15 }), renderAccountExists(brand, { name: nome, loginUrl: LINK })]) {
      expect(m.html).not.toContain('<script>')
      expect(m.html).not.toContain('<b>Ouro</b>')
      expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(m.html).toContain('Pet &lt;b&gt;Ouro&lt;/b&gt; &amp; &quot;Cia&quot;')
    }
  })

  test('sem imagens remotas, sem recursos externos (só o link de entrada, no aviso de conta existente)', () => {
    const codigo = renderSignupCode(brand, { name: 'Maria', code: '123456', ttlMin: 15 })
    expect(codigo.html).not.toMatch(/<img|<link|<script|<iframe|url\(|src=|https?:\/\//i)
    const existe = renderAccountExists(brand, { name: 'Maria', loginUrl: LINK })
    expect(existe.html).not.toMatch(/<img|<link|<script|<iframe|url\(|src=/i)
  })

  test('o assunto nunca leva quebra de linha; cor inválida cai na cor padrão (sem injetar CSS)', () => {
    const m = renderSignupCode({ name: 'Conta\r\nBcc: vitima@x.test', color: 'red;}</style><script>' }, { name: 'Maria', code: '123456', ttlMin: 15 })
    expect(m.subject).not.toMatch(/[\r\n]/)
    expect(m.html).not.toContain('</style><script>')
    expect(m.html).not.toContain('red;}')
  })

  test('conta já existe: sem código, diz "Este e-mail já tem conta. Entre com ela." e leva à entrada da loja', () => {
    const m = renderAccountExists(brand, { name: 'Maria', loginUrl: LINK })
    expect(m.text).not.toMatch(/\b\d{6}\b/)
    expect(m.text).toContain('Este e-mail já tem conta. Entre com ela.')
    expect(m.text).toContain(LINK)
    expect(m.text.toLowerCase()).toContain('esqueci')
    expect(m.subject.toLowerCase()).toContain('já')
  })
})
