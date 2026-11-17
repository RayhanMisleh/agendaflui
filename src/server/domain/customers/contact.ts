/** Normalização de contato, pura: também serve à validação de formulários. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PHONE_HELP =
  'Informe o telefone com DDD, por exemplo (11) 91234-5678. Para número de outro país, comece com + e o código do país.'

/** Mensagem de `normalizeContactPhone` para número de fora do Brasil escrito sem `+`. */
export const PHONE_FOREIGN_HELP = 'Comece com + e o código do país, por exemplo +49 151 1234 5678.'

/** Apara e põe em minúsculas. Inválido → `RangeError`. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new RangeError('Informe um e-mail válido, por exemplo nome@exemplo.com.')
  }
  return email
}

const NATIONAL = (digits: string) => digits.length === 10 || digits.length === 11

/**
 * Só dígitos, com DDI. `+` ou `00` no início marcam número internacional (mantido).
 * Sem eles, tira o zero de tronco ou de operadora e, com 10 ou 11 dígitos, assume o Brasil (55).
 * Inválido → `RangeError`.
 */
export function normalizePhone(input: string): string {
  if (/\p{L}/u.test(input)) throw new RangeError(PHONE_HELP)
  const plus = input.trim().startsWith('+')
  let digits = input.replace(/\D/g, '')
  let international = plus
  if (!plus && digits.startsWith('00')) {
    digits = digits.slice(2)
    international = true
  }
  if (!international) {
    if (digits.startsWith('0') && NATIONAL(digits.slice(1))) digits = digits.slice(1)
    else if (digits.startsWith('0') && NATIONAL(digits.slice(3))) digits = digits.slice(3)
    if (NATIONAL(digits)) digits = `55${digits}`
  }
  if (digits.startsWith('0') || digits.length < 10 || digits.length > 15) throw new RangeError(PHONE_HELP)
  return digits
}

/**
 * Como `normalizePhone`, para o telefone de contato do negócio (que não é um cadastro de balcão): número que não começa
 * com `+` nem `00` e não é do Brasil (sem o 55 e sem 10 ou 11 dígitos) é recusado, em vez de aceito em silêncio.
 * Inválido → `RangeError`.
 */
export function normalizeContactPhone(input: string): string {
  const digits = normalizePhone(input)
  const marcadoComoInternacional = input.trim().startsWith('+') || input.replace(/\D/g, '').startsWith('00')
  if (!marcadoComoInternacional && !digits.startsWith('55')) throw new RangeError(PHONE_FOREIGN_HELP)
  return digits
}

/** Chave de busca: sem acentos, minúscula, espaços colapsados e aparados. */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** '5511912345678' → '(11) 91234-5678'; fora do Brasil, '+' e os dígitos. */
export function formatPhone(digits: string): string {
  if (digits.startsWith('55') && digits.length === 13) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.startsWith('55') && digits.length === 12) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${digits}`
}
