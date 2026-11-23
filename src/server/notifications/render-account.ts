/*
 * E-mails de conta do app (código de cadastro, conta já existente, código de redefinição de senha).
 * Pura: recebe o nome e a cor da conta e devolve assunto, texto e HTML em pt-BR. Tudo que vem de dado é escapado
 * no HTML; o HTML não tem imagens nem recursos remotos; o assunto nunca leva quebra de linha.
 */

import { emailFrame, semControle, umaLinha, type Brand, type FrameContent } from './frame'

export type AccountBrand = Brand
export type RenderedMail = { subject: string; text: string; html: string }

const layout = (brand: AccountBrand, title: string, content: FrameContent) => emailFrame(brand, title, content)

const greeting = (customerName: string): string => `Olá, ${semControle(umaLinha(customerName))}.`

/** Código para confirmar o e-mail de um cadastro novo. */
export function renderRegistrationCode(brand: AccountBrand, i: { customerName: string; code: string; ttlMin: number }): RenderedMail {
  const title = 'Confirme seu e-mail'
  const body = layout(brand, title, {
    paragraphs: [
      greeting(i.customerName),
      `Use o código abaixo para terminar seu cadastro em ${semControle(umaLinha(brand.name))}. Ele vale por ${i.ttlMin} minutos.`,
      'Se não foi você, ignore este e-mail: nada será criado.',
    ],
    code: i.code,
  })
  return { subject: `${umaLinha(semControle(brand.name))}: seu código de confirmação`, ...body }
}

/** Aviso para quem tenta se cadastrar com um e-mail que já tem conta. Sem código. */
export function renderAccountExists(brand: AccountBrand, i: { customerName: string }): RenderedMail {
  const title = 'Você já tem uma conta'
  const body = layout(brand, title, {
    paragraphs: [
      greeting(i.customerName),
      `Este e-mail já tem uma conta em ${semControle(umaLinha(brand.name))}. Para entrar, use seu e-mail e sua senha.`,
      'Se você não lembra a senha, toque em "Esqueci minha senha" na tela de entrada do aplicativo. Se não foi você, ignore este e-mail.',
    ],
  })
  return { subject: `${umaLinha(semControle(brand.name))}: você já tem uma conta`, ...body }
}

/** Código para redefinir a senha. */
export function renderPasswordResetCode(brand: AccountBrand, i: { customerName: string; code: string; ttlMin: number }): RenderedMail {
  const title = 'Redefina sua senha'
  const body = layout(brand, title, {
    paragraphs: [
      greeting(i.customerName),
      `Use o código abaixo para criar uma senha nova em ${semControle(umaLinha(brand.name))}. Ele vale por ${i.ttlMin} minutos.`,
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ],
    code: i.code,
  })
  return { subject: `${umaLinha(semControle(brand.name))}: código para redefinir a senha`, ...body }
}

/** E-mail de teste do painel dev: prova que o canal de envio está configurado. Sem link, sem dado de conta. */
export function renderTestEmail(brand: AccountBrand, i: { adminName: string }): RenderedMail {
  const title = 'E-mail de teste'
  const body = layout(brand, title, {
    paragraphs: [
      greeting(i.adminName),
      'Este é um e-mail de teste do painel de plataforma. Se ele chegou, o envio de e-mails está funcionando.',
    ],
  })
  return { subject: `${umaLinha(brand.name)}: e-mail de teste`, ...body }
}
