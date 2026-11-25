import 'server-only'
import { cookies } from 'next/headers'
import { env } from '@/server/env'
import { MAX_LINES, MAX_QUANTITY, type RawCartLine } from '@/server/domain/store/cart'

/** O carrinho vive num cookie por loja (`Path=/<slug>`), lido e preçado no servidor: nada do preço vem do navegador. */
export const CART_COOKIE = 'af_carrinho'
const TRINTA_DIAS = 30 * 24 * 60 * 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lê o texto do cookie: JSON que não for uma lista de `{ productId, quantity }` vira carrinho vazio; linha sem id válido ou
 * com quantidade que não é inteira positiva sai; o mesmo produto em duas linhas soma (até 99); só as 20 primeiras linhas ficam.
 */
export function parseCartCookie(raw: string | undefined): RawCartLine[] {
  if (raw === undefined || raw === '') return []
  let lido: unknown
  try {
    lido = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(lido)) return []
  const linhas = new Map<string, number>()
  for (const item of lido) {
    if (typeof item !== 'object' || item === null) continue
    const { productId, quantity } = item as Record<string, unknown>
    if (typeof productId !== 'string' || !UUID.test(productId) || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) continue
    const id = productId.toLowerCase()
    if (!linhas.has(id) && linhas.size >= MAX_LINES) continue
    linhas.set(id, Math.min(MAX_QUANTITY, (linhas.get(id) ?? 0) + quantity))
  }
  return [...linhas].map(([productId, quantity]) => ({ productId, quantity }))
}

/** O carrinho da loja que está sendo aberta: o cookie só viaja para `/<slug>/**`, então nunca se lê o de outra loja. */
export async function readCart(): Promise<RawCartLine[]> {
  return parseCartCookie((await cookies()).get(CART_COOKIE)?.value)
}

/** Grava o carrinho da loja (`httpOnly`, 30 dias, só no caminho dela); vazio apaga o cookie. */
export async function writeCart(slug: string, lines: RawCartLine[]): Promise<void> {
  const jar = await cookies()
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: env.NODE_ENV === 'production', path: `/${slug}` }
  if (lines.length === 0) jar.set(CART_COOKIE, '', { ...base, maxAge: 0 })
  else jar.set(CART_COOKIE, JSON.stringify(lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))), { ...base, maxAge: TRINTA_DIAS })
}

/** Quantas unidades há no carrinho (o número do ícone). */
export function totalDeUnidades(lines: RawCartLine[]): number {
  return lines.reduce((soma, l) => soma + l.quantity, 0)
}
