/**
 * A marca da conta de demonstração: nome, paleta e imagens próprios, como os de um cliente de verdade (nada da Agenda Flui).
 * Os SVGs ficam em `scripts/demo-marca/`; o nome do logo está em curvas, então a imagem não depende de fonte do servidor.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const DEMO_MARCA = { nome: 'Focinho Feliz Pet Shop', primaria: '#B4432F', destaque: '#F4C84A' } as const

function arquivo(nome: string): string {
  return fileURLToPath(new URL(`./demo-marca/${nome}`, import.meta.url))
}

async function png(svg: Buffer, largura: number, altura: number): Promise<Uint8Array> {
  const bytes = await sharp(svg, { density: 300 }).resize(largura, altura, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  return new Uint8Array(bytes)
}

/** Logo (1200 × 400), símbolo (512 × 512) e favicon (64 × 64) em PNG, dentro dos limites de `src/server/storage/images.ts`. */
export async function renderDemoBrandImages(): Promise<{ logo: Uint8Array; symbol: Uint8Array; favicon: Uint8Array }> {
  const [logo, simbolo] = await Promise.all([readFile(arquivo('logo.svg')), readFile(arquivo('simbolo.svg'))])
  const [logoPng, symbolPng, faviconPng] = await Promise.all([png(logo, 1200, 400), png(simbolo, 512, 512), png(simbolo, 64, 64)])
  return { logo: logoPng, symbol: symbolPng, favicon: faviconPng }
}
