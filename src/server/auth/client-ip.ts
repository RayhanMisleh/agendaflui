import { isIP } from 'node:net'

/**
 * IP do cliente atrás de `trustedHops` proxies confiáveis: o endereço que está `trustedHops`
 * posições antes do fim de `X-Forwarded-For` (cada proxy confiável acrescenta o que viu ao fim,
 * então só o fim da lista não é forjável). Sem proxy configurado (0) o cabeçalho é ignorado: o
 * servidor Next não expõe o IP do socket, e qualquer cliente pode escrever esse cabeçalho.
 */
export function clientIp(headers: Headers, trustedHops: number): string | null {
  if (!Number.isInteger(trustedHops) || trustedHops < 1) return null
  const lista = headers.get('x-forwarded-for')
  if (!lista) return null
  const enderecos = lista.split(',').map((e) => e.trim())
  const escolhido = enderecos[enderecos.length - trustedHops]
  return escolhido !== undefined && isIP(escolhido) !== 0 ? escolhido : null
}
