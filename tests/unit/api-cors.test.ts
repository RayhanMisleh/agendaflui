import { isSyntacticOrigin, originAllowed } from '@/server/api/cors'

describe('originAllowed', () => {
  const lista = ['https://app.exemplo.com', 'https://app.exemplo.com:8443', 'http://*.localhost:5173']

  test('casa a origem salva exatamente', () => {
    expect(originAllowed('https://app.exemplo.com', lista)).toBe(true)
    expect(originAllowed('https://app.exemplo.com:8443', lista)).toBe(true)
  })

  test('não casa origem parecida: outro esquema, porta, subdomínio, sufixo ou maiúsculas diferentes de um host salvo', () => {
    expect(originAllowed('http://app.exemplo.com', lista)).toBe(false)
    expect(originAllowed('https://app.exemplo.com:9000', lista)).toBe(false)
    expect(originAllowed('https://x.app.exemplo.com', lista)).toBe(false)
    expect(originAllowed('https://app.exemplo.com.evil.com', lista)).toBe(false)
    expect(originAllowed('https://evilapp.exemplo.com', lista)).toBe(false)
    expect(originAllowed('null', lista)).toBe(false)
    expect(originAllowed('', lista)).toBe(false)
  })

  test('lista vazia não libera nenhuma origem', () => {
    expect(originAllowed('https://app.exemplo.com', [])).toBe(false)
    expect(originAllowed('http://a.localhost:5173', [])).toBe(false)
  })

  test('curinga de localhost casa qualquer subdomínio naquela porta e nada além', () => {
    expect(originAllowed('http://loja.localhost:5173', lista)).toBe(true)
    expect(originAllowed('http://a.b.localhost:5173', lista)).toBe(true)
    expect(originAllowed('http://loja.localhost:5174', lista)).toBe(false)
    expect(originAllowed('http://loja.localhost', lista)).toBe(false)
    expect(originAllowed('http://localhost:5173', lista)).toBe(false)
    expect(originAllowed('http://.localhost:5173', lista)).toBe(false)
    expect(originAllowed('http://localhost.evil.com:5173', lista)).toBe(false)
    expect(originAllowed('http://loja.localhost.evil.com:5173', lista)).toBe(false)
    expect(originAllowed('https://loja.localhost:5173', lista)).toBe(false)
    expect(originAllowed('http://evil.com/.localhost:5173', lista)).toBe(false)
    expect(originAllowed('http://a@evil.com:5173/.localhost:5173', lista)).toBe(false)
    expect(originAllowed('http://a..localhost:5173', lista)).toBe(false)
  })

  test('curinga sem porta casa só origem sem porta', () => {
    expect(originAllowed('http://loja.localhost', ['http://*.localhost'])).toBe(true)
    expect(originAllowed('http://loja.localhost:3000', ['http://*.localhost'])).toBe(false)
  })
})

describe('isSyntacticOrigin', () => {
  test('aceita http e https com host e porta opcional', () => {
    for (const o of ['https://app.exemplo.com', 'http://localhost:3000', 'http://[::1]:3000', 'http://a.localhost']) {
      expect(isSyntacticOrigin(o), o).toBe(true)
    }
  })

  test('recusa o que não é origem', () => {
    for (const o of ['null', '', '*', 'ftp://a.com', 'https://a.com/caminho', 'https://a.com?x=1', 'https://usuario@a.com', 'a.com', 'https://', 'https://a b.com']) {
      expect(isSyntacticOrigin(o), o).toBe(false)
    }
    expect(isSyntacticOrigin(`https://${'a'.repeat(400)}.com`)).toBe(false)
  })
})
