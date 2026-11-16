/** Normalização de contato, pura: também serve à validação de formulários. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PHONE_HELP = 'Informe o telefone com DDD, por exemplo (11) 91234-5678.'

/** Apara e põe em minúsculas. Inválido → `RangeError`. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new RangeError('Informe um e-mail válido, por exemplo nome@exemplo.com.')
  }
  return email
}

/** Só dígitos, com DDI. Sem DDI (10 ou 11 dígitos), assume o Brasil (55). Inválido → `RangeError`. */
export function normalizePhone(input: string): string {
  const plus = input.trim().startsWith('+')
  let digits = input.replace(/\D/g, '')
  if (!plus && digits.startsWith('00')) digits = digits.slice(2)
  if (!plus && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`
  if (digits.length < 10 || digits.length > 15) throw new RangeError(PHONE_HELP)
  return digits
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
