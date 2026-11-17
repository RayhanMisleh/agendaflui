/*
 * E-mail de redefinição de senha do painel: o link leva à tela de escolher a senha nova. Puro. Com a marca AgendaFlui,
 * porque a pessoa pode ter acesso a mais de uma conta. O token só aparece dentro do link. Tudo que vem de dado é escapado
 * no HTML (a moldura faz isso); o assunto nunca leva quebra de linha.
 */

import { emailFrame, limpo } from './frame'
import { PLATFORM_MAIL_BRAND } from './render-invite'
import type { RenderedMail } from './render-account'

export function renderPanelPasswordReset(i: { name: string; link: string; ttlMin: number; businessName?: string }): RenderedMail {
  const title = 'Redefina sua senha'
  const conta = i.businessName ? ` em ${limpo(i.businessName)}` : ''
  const body = emailFrame(PLATFORM_MAIL_BRAND, title, {
    paragraphs: [
      `Olá, ${limpo(i.name)}.`,
      `Escolha uma senha nova para entrar no AgendaFlui${conta}. O link vale por ${i.ttlMin} minutos e só pode ser usado uma vez.`,
      'Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
    ],
    action: { label: 'Redefinir minha senha', href: i.link },
  })
  return { subject: 'AgendaFlui: redefina sua senha', ...body }
}
