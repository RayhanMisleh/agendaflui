import { contrastRatio } from '@/shared/theme/color'
import { emailFrame } from '@/server/notifications/frame'

const cores = (html: string) => ({
  cabecalhoBg: /<div style="background:(#[0-9A-F]{6});color:(#[0-9A-F]{6});padding:16px 24px/.exec(html),
})

describe('emailFrame (moldura comum)', () => {
  test('cabeçalho com nome e cor, rodapé, largura de 600 px e sem recursos remotos', () => {
    const f = emailFrame({ name: 'Conta <b>X</b>', color: '#2F6B4F' }, 'Título', { paragraphs: ['Oi & tchau'] })
    expect(f.html).toContain('max-width:600px')
    expect(f.html).toContain('Conta &lt;b&gt;X&lt;/b&gt;')
    expect(f.html).toContain('Oi &amp; tchau')
    expect(f.html).not.toMatch(/<img|https?:\/\/|@import|<link/)
    expect(f.text).toContain('Oi & tchau')
    expect(f.text).toContain('Conta <b>X</b>')
  })

  test('cor inválida cai na Água da marca e o texto do cabeçalho tem contraste', () => {
    const f = emailFrame({ name: 'X', color: 'azul' }, 'T', { paragraphs: [] })
    const m = cores(f.html).cabecalhoBg
    expect(m?.[1]).toBe('#0B6E66')
    expect(contrastRatio(m![1]!, m![2]!)).toBeGreaterThanOrEqual(4.5)
  })

  test.each(['#FFFF00', '#808080', '#000000', '#7A1F2B'])('cabeçalho na cor da conta com texto legível (%s)', (color) => {
    const m = cores(emailFrame({ name: 'X', color }, 'T', { paragraphs: [] }).html).cabecalhoBg
    expect(m).not.toBeNull()
    expect(contrastRatio(m![1]!, m![2]!)).toBeGreaterThanOrEqual(4.5)
  })

  test('fundo espuma, texto em tinta e fontes só do sistema', () => {
    const f = emailFrame({ name: 'X', color: '#0B6E66' }, 'T', { paragraphs: ['a'] })
    expect(f.html).toContain('background:#F3F8F6')
    expect(f.html).toContain('color:#0F2A27')
    expect(f.html).toContain("font-family:-apple-system,'Segoe UI'")
    expect(f.html).not.toMatch(/Bricolage|Figtree/)
  })

  test('botão em pílula na cor da conta; o endereço também vai no texto puro', () => {
    const f = emailFrame({ name: 'X', color: '#0B6E66' }, 'T', { paragraphs: [], action: { label: 'Escolher senha', href: 'https://exemplo.test/a?b=1&c=2' } })
    expect(f.html).toMatch(/<a href="https:\/\/exemplo\.test\/a\?b=1&amp;c=2" style="[^"]*border-radius:999px;background:#0B6E66;color:#FFFFFF/)
    expect(f.text).toContain('Escolher senha: https://exemplo.test/a?b=1&c=2')
  })
})
