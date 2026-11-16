import { isIP } from 'node:net'

const IPV4_COM_PORTA = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/
const IPV6_COM_COLCHETES = /^\[([^\]]+)\](?::\d+)?$/
const IPV4_MAPEADO = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

/** Endereço sem porta nem colchetes, IPv4 mapeado em IPv6 como IPv4 e IPv6 em minúsculas; `null` se não for IP. */
function normalizar(bruto: string): string | null {
  let e = bruto.trim()
  const colchetes = IPV6_COM_COLCHETES.exec(e)
  if (colchetes?.[1]) e = colchetes[1]
  else {
    const comPorta = IPV4_COM_PORTA.exec(e)
    if (comPorta?.[1]) e = comPorta[1]
  }
  e = e.toLowerCase()
  const mapeado = IPV4_MAPEADO.exec(e)
  if (mapeado?.[1]) e = mapeado[1]
  return isIP(e) === 0 ? null : e
}

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
  const enderecos = lista.split(',')
  const escolhido = enderecos[enderecos.length - trustedHops]
  return escolhido === undefined ? null : normalizar(escolhido)
}

/** Os 8 grupos de um IPv6 válido, sem compressão `::`. */
function gruposIpv6(ip: string): number[] {
  let texto = ip.toLowerCase()
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(texto)
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.slice(1).map(Number)
    texto = `${texto.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [cabeca = '', cauda] = texto.split('::')
  const lado = (t: string): string[] => (t === '' ? [] : t.split(':'))
  const inicio = lado(cabeca)
  const fim = cauda === undefined ? [] : lado(cauda)
  const zeros = cauda === undefined ? [] : Array<string>(8 - inicio.length - fim.length).fill('0')
  return [...inicio, ...zeros, ...fim].map((g) => Number.parseInt(g, 16))
}

/**
 * Parte do IP que entra na chave de limite: o próprio IPv4, ou o prefixo /64 do IPv6 expandido
 * (`2001:db8:0:0::/64`), para quem tem um /64 inteiro não escapar trocando de endereço.
 */
export function ipLimitKeyPart(ip: string): string {
  if (isIP(ip) !== 6) return ip
  return `${gruposIpv6(ip).slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}
