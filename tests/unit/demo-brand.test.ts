import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { DEMO_MARCA, renderDemoBrandImages } from '../../scripts/demo-brand'
import { REGRAS } from '../../src/server/storage/images'

const svg = (nome: string): string => readFileSync(fileURLToPath(new URL(`../../scripts/demo-marca/${nome}`, import.meta.url)), 'utf8')

describe('marca da demonstração', () => {
  test('os SVGs não usam <text> (o nome está em curvas: não depende de fonte do servidor)', () => {
    for (const nome of ['logo.svg', 'simbolo.svg']) {
      const conteudo = svg(nome)
      expect(conteudo).toContain('<svg')
      expect(conteudo).not.toMatch(/<text[\s>]/i)
      expect(conteudo).not.toMatch(/<tspan[\s>]/i)
    }
    expect(svg('logo.svg')).toContain('<path')
  })

  test('a paleta da demo não é a da Agenda Flui nem a antiga da demo', () => {
    expect(DEMO_MARCA.nome).toBe('Focinho Feliz Pet Shop')
    expect(['#0B6E66', '#2F7D5B']).not.toContain(DEMO_MARCA.primaria.toUpperCase())
    expect(['#F2A93B', '#F29A4B']).not.toContain(DEMO_MARCA.destaque.toUpperCase())
    expect(DEMO_MARCA.primaria).toMatch(/^#[0-9A-F]{6}$/i)
    expect(DEMO_MARCA.destaque).toMatch(/^#[0-9A-F]{6}$/i)
    // As cores do desenho são as da marca da demo.
    expect(svg('simbolo.svg').toUpperCase()).toContain(DEMO_MARCA.primaria.toUpperCase())
    expect(svg('simbolo.svg').toUpperCase()).toContain(DEMO_MARCA.destaque.toUpperCase())
  })

  test('renderiza logo, símbolo e favicon como PNG nos tamanhos aceitos pelo upload', async () => {
    const imagens = await renderDemoBrandImages()
    const meta = async (bytes: Uint8Array) => sharp(Buffer.from(bytes)).metadata()
    const logo = await meta(imagens.logo)
    const simbolo = await meta(imagens.symbol)
    const favicon = await meta(imagens.favicon)
    for (const m of [logo, simbolo, favicon]) expect(m.format).toBe('png')
    expect(logo.width).toBeLessThanOrEqual(REGRAS.logo.w)
    expect(logo.height).toBeLessThanOrEqual(REGRAS.logo.h)
    expect(logo.width).toBeGreaterThan(logo.height ?? 0)
    expect(simbolo.width).toBe(simbolo.height)
    expect(simbolo.width).toBeGreaterThanOrEqual(REGRAS.symbol.min ?? 0)
    expect(simbolo.width).toBeLessThanOrEqual(REGRAS.symbol.w)
    expect(favicon.width).toBe(REGRAS.favicon.w)
    expect(favicon.height).toBe(REGRAS.favicon.h)
  })

  test('o logo não é uma imagem vazia: tem a cor da marca', async () => {
    const { logo } = await renderDemoBrandImages()
    const { data, info } = await sharp(Buffer.from(logo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let primaria = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] === 0xb4 && data[i + 1] === 0x43 && data[i + 2] === 0x2f && (data[i + 3] ?? 0) > 200) primaria += 1
    }
    expect(primaria).toBeGreaterThan(1000)
  })
})
