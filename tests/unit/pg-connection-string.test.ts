import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { pgConfig, pgConnectionString } from '@/server/db/connection'

const base = 'postgres://u:p@h:5432/d'

describe('pgConnectionString', () => {
  test.each(['require', 'verify-full', 'verify-ca', 'prefer', 'disable'])('sslmode=%s ganha uselibpqcompat=true', (modo) => {
    const url = new URL(pgConnectionString(`${base}?sslmode=${modo}`))
    expect(url.searchParams.get('sslmode')).toBe(modo)
    expect(url.searchParams.get('uselibpqcompat')).toBe('true')
  })

  test('URL sem sslmode não muda', () => {
    expect(pgConnectionString(base)).toBe(base)
    expect(pgConnectionString(`${base}?connect_timeout=5`)).toBe(`${base}?connect_timeout=5`)
  })

  test('uselibpqcompat já presente é respeitado, inclusive false', () => {
    const a = `${base}?sslmode=require&uselibpqcompat=true`
    const b = `${base}?sslmode=require&uselibpqcompat=false`
    expect(pgConnectionString(a)).toBe(a)
    expect(pgConnectionString(b)).toBe(b)
  })

  test('preserva os demais parâmetros', () => {
    const url = new URL(pgConnectionString(`${base}?schema=public&sslmode=require&application_name=app%20x`))
    expect(url.searchParams.get('schema')).toBe('public')
    expect(url.searchParams.get('application_name')).toBe('app x')
    expect(url.searchParams.get('uselibpqcompat')).toBe('true')
  })

  test('senha com caracteres especiais continua igual', () => {
    const senha = 'p%40ss%3Aw%2Ford%23%3F%26'
    const saida = pgConnectionString(`postgres://us%40er:${senha}@h:5432/d?sslmode=require`)
    expect(saida).toContain(`:${senha}@`)
    expect(saida).toContain('us%40er')
    expect(new URL(saida).password).toBe(senha)
  })

  test('texto que não é URL volta como veio, sem lançar nem repetir o valor', () => {
    expect(pgConnectionString('isto nao e url sslmode=require')).toBe('isto nao e url sslmode=require')
  })

  test('pgConfig usa a URL já ajustada e mantém o fuso UTC', () => {
    const c = pgConfig(`${base}?sslmode=require`)
    expect(c.connectionString).toContain('uselibpqcompat=true')
    expect(c.options).toBe('-c timezone=UTC')
  })
})

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (nome === 'generated' || nome === 'node_modules') return []
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.tsx?$/.test(nome) ? [caminho] : []
  })
}

describe('toda conexão do pg passa por pgConnectionString', () => {
  test('src/ e scripts/ não criam Client/Pool/PrismaPg com URL crua', () => {
    const chamada = /new (?:pg\.)?(?:Client|Pool)\(|PrismaPg\(/g
    const ruins: string[] = []
    for (const arquivo of [...arquivos('src'), ...arquivos('scripts')]) {
      const texto = readFileSync(arquivo, 'utf8')
      for (const m of texto.matchAll(chamada)) {
        const trecho = texto.slice(m.index, m.index + 200)
        if (!/pgConnectionString\(|pgConfig\(/.test(trecho)) ruins.push(`${arquivo}: ${trecho.split('\n')[0]}`)
      }
    }
    expect(ruins).toEqual([])
  })
})
