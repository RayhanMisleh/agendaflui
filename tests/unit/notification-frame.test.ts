import { emailFrame } from '@/server/notifications/frame'

describe('emailFrame (moldura comum)', () => {
  test('cabeçalho com nome e cor, rodapé, largura de 600 px e sem recursos remotos', () => {
    const f = emailFrame({ name: 'Conta <b>X</b>', color: '#2F6B4F' }, 'Título', { paragraphs: ['Oi & tchau'] })
    expect(f.html).toContain('max-width:600px')
    expect(f.html).toContain('Conta &lt;b&gt;X&lt;/b&gt;')
    expect(f.html).toContain('Oi &amp; tchau')
    expect(f.html).not.toMatch(/<img|https?:\/\//)
    expect(f.text).toContain('Oi & tchau')
    expect(f.text).toContain('Conta <b>X</b>')
  })

  test('cor inválida cai na padrão e o texto sobre a cor tem contraste', () => {
    const f = emailFrame({ name: 'X', color: 'azul' }, 'T', { paragraphs: [] })
    expect(f.html).toContain('#0E4F5C')
  })
})
