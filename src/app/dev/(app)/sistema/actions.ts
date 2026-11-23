'use server'
import { revalidatePath } from 'next/cache'
import { retryFailedNotification, sendTestEmail } from '@/server/domain/platform/system'
import type { ChannelErrorCode } from '@/server/notifications/channels/types'
import { feito, ler } from '@/app/_lib/campos'
import { porAlvo } from '../_lib/campos'
import { adminAction } from '../_lib/action'

/** Devolve um aviso em falha para a fila. O id vem ligado no servidor; o domínio recusa o que não está mais em falha. */
export const tentarDeNovo = porAlvo(
  [],
  (admin, _v, id) => retryFailedNotification(admin, id, new Date()),
  (_r, v) => {
    revalidatePath('/dev/sistema')
    return feito('Aviso devolvido à fila.', v)
  },
)

const NOME_DO_CANAL = { resend: 'Resend', smtp: 'SMTP', file: 'arquivo local', none: 'nenhum canal' } as const

const MOTIVO: Record<ChannelErrorCode, string> = {
  not_configured: 'o envio de e-mail não está configurado neste ambiente (falta RESEND_API_KEY ou SMTP_URL)',
  channel_error: 'o provedor recusou o envio; confira a chave e se o domínio do remetente está verificado',
  timeout: 'o provedor não respondeu a tempo',
  invalid_recipient: 'o e-mail do seu usuário admin não é um endereço válido',
  internal_error: 'erro interno ao enviar',
}

/** Manda um e-mail de teste ao próprio admin e mostra na tela o que aconteceu (canal e motivo da falha, nunca o provedor). */
export const enviarEmailDeTeste = adminAction(
  (fd) => ler(fd, []),
  (admin) => sendTestEmail(admin, new Date()),
  (r, v) =>
    r.ok
      ? feito(`E-mail enviado para ${r.to} pelo ${NOME_DO_CANAL[r.channel]}.`, v)
      : { ok: false, message: `Não deu para enviar: ${MOTIVO[r.error ?? 'internal_error']}.`, fields: {}, values: v },
)
