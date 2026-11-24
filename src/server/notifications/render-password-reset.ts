/*
 * E-mail de redefinição de senha: o link leva à tela de escolher a senha nova. Puro. Com a marca Agenda Flui,
 * porque a conta é da pessoa, não de uma loja. O token só aparece dentro do link. Tudo que vem de dado é escapado
 * no HTML (a moldura faz isso); o assunto nunca leva quebra de linha.
 */

import { emailFrame, limpo } from './frame'
import { PLATFORM_MAIL_BRAND } from './render-invite'
import type { RenderedMail } from './render-account'

export function renderPasswordReset(i: { name: string; link: string; ttlMin: number; businessName?: string }): RenderedMail {
  const title = 'Redefina sua senha'
  const conta = i.businessName ? ` em ${limpo(i.businessName)}` : ''
  const body = emailFrame(PLATFORM_MAIL_BRAND, title, {
    paragraphs: [
      `Olá, ${limpo(i.name)}.`,
      `Escolha uma senha nova para entrar no Agenda Flui${conta}. O link vale por ${i.ttlMin} minutos e só pode ser usado uma vez.`,
      'Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
    ],
    action: { label: 'Redefinir minha senha', href: i.link },
  })
  return { subject: 'Agenda Flui: redefina sua senha', ...body }
}
