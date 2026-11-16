/*
 * E-mails de conta do app (código de cadastro, conta já existente, código de redefinição de senha).
 * Pura: recebe o nome e a cor da conta e devolve assunto, texto e HTML em pt-BR. Tudo que vem de dado é escapado
 * no HTML; o HTML não tem imagens nem recursos remotos; o assunto nunca leva quebra de linha.
 */

export type AccountBrand = { name: string; color: string }
export type RenderedMail = { subject: string; text: string; html: string }

const COR_PADRAO = '#0E4F5C'
const COR_VALIDA = /^#[0-9a-f]{6}$/i

const escapeHtml = (texto: string): string =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

const umaLinha = (texto: string): string => texto.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()

const semControle = (texto: string): string => texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

type Content = {
  /** Linhas de texto; cada uma vira um parágrafo. */
  paragraphs: string[]
  /** Código em destaque. */
  code?: string
}

function layout(brand: AccountBrand, title: string, content: Content): { text: string; html: string } {
  const name = umaLinha(semControle(brand.name))
  const color = COR_VALIDA.test(brand.color) ? brand.color : COR_PADRAO
  const text = [name, '', title, '', ...content.paragraphs.flatMap((p) => [p, '']), ...(content.code ? [`Código: ${content.code}`, ''] : [])]
    .join('\n')
    .trim()
  const paragraphs = content.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2933">${escapeHtml(p)}</p>`).join('')
  const code = content.code
    ? `<p style="margin:0 0 16px;font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:700;color:#1f2933;font-family:Menlo,Consolas,monospace">${escapeHtml(content.code)}</p>`
    : ''
  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f5f7"><div style="max-width:480px;margin:0 auto;padding:16px">` +
    `<div style="background:#ffffff;border-top:6px solid ${color};padding:24px">` +
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.4;font-weight:700;color:#1f2933">${escapeHtml(name)}</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1f2933">${escapeHtml(title)}</h1>` +
    `${paragraphs}${code}</div></div></body></html>`
  return { text, html }
}

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
