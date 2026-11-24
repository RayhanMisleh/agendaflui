import { INVITE_INVALID_MESSAGE } from '@/server/auth/invites'
import type { GoogleFailure, GoogleSuccess } from '@/server/auth/google/callback'

/** O texto de cada resultado do Google, mostrado nas telas de entrada pelo `?google=<código>`. */
export const GOOGLE_MESSAGES: Record<GoogleFailure | GoogleSuccess, string> = {
  account_exists: 'Este e-mail já tem conta no Agenda Flui. Entre com a sua senha e vincule o Google em Minha conta.',
  unknown_google: 'Não achamos uma conta com este Google. Se você é cliente, entre pelo link que a sua loja enviou.',
  google_taken: 'Este Google já está ligado a outra conta.',
  email_not_verified: 'Esta conta Google não tem o e-mail confirmado. Use outra conta ou entre com e-mail e senha.',
  email_mismatch: 'Use a conta Google com o mesmo e-mail do convite ou da sua conta.',
  invite_invalid: INVITE_INVALID_MESSAGE,
  store_unavailable: 'Esta loja não está disponível agora.',
  already_linked: 'Sua conta já tem um Google. Desvincule antes de trocar.',
  not_signed_in: 'Entre na sua conta para vincular o Google.',
  not_configured: 'Entrar com Google não está disponível agora.',
  flow_invalid: 'O tempo para entrar com o Google acabou. Tente de novo.',
  canceled: 'Entrada com Google cancelada.',
  provider_error: 'O Google não respondeu. Tente de novo em instantes.',
  rate_limited: 'Muitas tentativas. Tente de novo em alguns minutos.',
  calendar_needs_google: 'Vincule o Google na sua conta antes de ligar a agenda.',
  calendar_wrong_google: 'Use a mesma conta Google vinculada à sua conta.',
  calendar_staff_only: 'A agenda do Google é para quem é da equipe de uma loja.',
  calendar_scope_missing: 'Marque a permissão da agenda na tela do Google para ligar.',
  vinculado: 'Google vinculado.',
  agenda_ligada: 'Google Agenda ligada. Seus próximos atendimentos aparecem nela em instantes.',
  agenda_desligada: 'Google Agenda desligada.',
}

const SUCESSOS: ReadonlySet<string> = new Set<GoogleSuccess>(['vinculado', 'agenda_ligada', 'agenda_desligada'])

/** A mensagem de um código vindo da URL; código desconhecido não mostra nada. */
export function googleMessage(codigo: string): { text: string; ok: boolean } | null {
  if (!Object.hasOwn(GOOGLE_MESSAGES, codigo)) return null
  return { text: GOOGLE_MESSAGES[codigo as keyof typeof GOOGLE_MESSAGES], ok: SUCESSOS.has(codigo) }
}
