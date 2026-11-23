/**
 * Máscaras de digitação (só interface): formatam o que a pessoa digita. A validação e a normalização são do servidor, que
 * aceita o valor com ou sem pontuação. Funções puras, sem DOM.
 */

/** Telefone do Brasil `(11) 91234-5678` / `(11) 1234-5678`; começando com `+`, número de fora, só `+`, dígitos e espaços. */
export function maskPhone(input: string): string {
  if (input.trimStart().startsWith('+')) {
    const resto = input.replace(/[^\d ]/g, '').replace(/ {2,}/g, ' ').trimStart().slice(0, 20)
    return `+${resto}`
  }
  let d = input.replace(/\D/g, '')
  // Número colado com o código do Brasil na frente (ex.: 5511912345678).
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const resto = d.slice(2)
  const corte = d.length === 11 ? 5 : 4
  if (resto.length <= corte) return `(${d.slice(0, 2)}) ${resto}`
  return `(${d.slice(0, 2)}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** `00000-000`. */
export function maskCep(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

const so = (v: string, ate: number) => v.slice(0, ate)

/**
 * CPF `000.000.000-00` ou CNPJ `00.000.000/0000-00` no mesmo campo. Até 11 caracteres só com dígitos é CPF; com letra ou
 * com mais de 11 caracteres é CNPJ. O CNPJ alfanumérico da Receita aceita letras (maiúsculas) nas 12 primeiras posições; as
 * duas últimas são dígitos verificadores, sempre números.
 */
export function maskDocument(input: string): string {
  const limpo = input.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (limpo.length <= 11 && /^\d*$/.test(limpo)) return maskCpf(limpo)
  const cnpj = so(limpo.slice(0, 12) + limpo.slice(12).replace(/\D/g, ''), 14)
  return maskCnpj(cnpj)
}

function maskCpf(d: string): string {
  const g = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11)]
  let r = g[0] ?? ''
  if (g[1]) r += `.${g[1]}`
  if (g[2]) r += `.${g[2]}`
  if (g[3]) r += `-${g[3]}`
  return r
}

function maskCnpj(v: string): string {
  const g = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 8), v.slice(8, 12), v.slice(12, 14)]
  let r = g[0] ?? ''
  if (g[1]) r += `.${g[1]}`
  if (g[2]) r += `.${g[2]}`
  if (g[3]) r += `/${g[3]}`
  if (g[4]) r += `-${g[4]}`
  return r
}

export type MaskKind = 'phone' | 'document' | 'cep'

export const MASKS: Record<MaskKind, (v: string) => string> = { phone: maskPhone, document: maskDocument, cep: maskCep }

/** Atributos de acessibilidade e tamanho de cada campo mascarado. */
export const MASK_ATTRS: Record<MaskKind, { inputMode: 'tel' | 'text' | 'numeric'; autoComplete: string; maxLength: number }> = {
  phone: { inputMode: 'tel', autoComplete: 'tel', maxLength: 22 },
  document: { inputMode: 'text', autoComplete: 'off', maxLength: 18 },
  cep: { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 9 },
}
