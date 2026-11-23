/*
 * E-mails que a plataforma manda ao dono de uma conta nova: convite para definir a senha e aviso de acesso a uma conta
 * nova (para quem já tem usuário). Puro. Com a marca Agenda Flui, porque quem recebe ainda não escolheu uma conta.
 * Tudo que vem de dado é escapado no HTML (a moldura faz isso); o assunto nunca leva quebra de linha.
 */

import { emailFrame, limpo, type Brand } from './frame'
import type { RenderedMail } from './render-account'

/** Marca da plataforma nos e-mails que ainda não pertencem a uma conta. */
export const PLATFORM_MAIL_BRAND: Brand = { name: 'Agenda Flui', color: '#0B6E66' }

const saudacao = (nome: string): string => `Olá, ${limpo(nome)}.`

/** Convite do dono: o link leva à tela de definir a senha. O token só aparece dentro do link. */
export function renderOwnerInvite(i: { ownerName: string; businessName: string; link: string; ttlDays: number }): RenderedMail {
  const title = 'Defina sua senha'
  const conta = limpo(i.businessName)
  const body = emailFrame(PLATFORM_MAIL_BRAND, title, {
    paragraphs: [
      saudacao(i.ownerName),
      `A conta ${conta} foi criada para você no Agenda Flui. Escolha sua senha para entrar. O link vale por ${i.ttlDays} dias e só pode ser usado uma vez.`,
      'Se você não esperava este e-mail, ignore-o: nada será feito sem a sua senha.',
    ],
    action: { label: 'Escolher minha senha', href: i.link },
  })
  return { subject: `Agenda Flui: defina sua senha para entrar em ${conta}`, ...body }
}

/** Aviso a quem já tem usuário e ganhou acesso de dono a mais uma conta. Sem convite e sem mexer na senha. */
export function renderAccessGranted(i: { ownerName: string; businessName: string; entryLink: string }): RenderedMail {
  const title = 'Você tem uma conta nova'
  const conta = limpo(i.businessName)
  const body = emailFrame(PLATFORM_MAIL_BRAND, title, {
    paragraphs: [
      saudacao(i.ownerName),
      `Você agora tem acesso a ${conta} no Agenda Flui. Entre com o seu e-mail e a senha que você já usa. Se tiver mais de uma conta, escolha ${conta} na lista.`,
      'Se você não esperava este acesso, fale com o suporte do Agenda Flui.',
    ],
    action: { label: `Entrar em ${conta}`, href: i.entryLink },
  })
  return { subject: `Agenda Flui: você agora tem acesso a ${conta}`, ...body }
}

/** Convite de quem entra na equipe de uma conta e ainda não tem senha. O token só aparece dentro do link. */
export function renderMemberInvite(i: { name: string; businessName: string; roleLabel: string; link: string; ttlDays: number }): RenderedMail {
  const title = 'Defina sua senha'
  const conta = limpo(i.businessName)
  const body = emailFrame(PLATFORM_MAIL_BRAND, title, {
    paragraphs: [
      saudacao(i.name),
      `Você foi adicionado à equipe de ${conta} no Agenda Flui, como ${limpo(i.roleLabel)}. Escolha sua senha para entrar. O link vale por ${i.ttlDays} dias e só pode ser usado uma vez.`,
      'Se você não esperava este e-mail, ignore-o: nada será feito sem a sua senha.',
    ],
    action: { label: 'Escolher minha senha', href: i.link },
  })
  return { subject: `Agenda Flui: defina sua senha para entrar em ${conta}`, ...body }
}
