/*
 * Moldura comum dos e-mails (cabeçalho com o nome e a cor da conta, conteúdo, rodapé). Pura. Usada pelos e-mails de
 * conta (código de cadastro, senha) e pelos avisos de agendamento. Tudo que vem de dado é escapado no HTML; não há
 * imagem nem recurso remoto; a versão em texto puro sempre existe.
 */
import { deriveTheme } from '@/shared/theme/derive'

export type Brand = { name: string; color: string }
export type FrameContent = {
  /** Cada linha vira um parágrafo. */
  paragraphs: string[]
  /** Detalhes em tabela simples: rótulo e valor. */
  rows?: [label: string, value: string][]
  /** Código em destaque. */
  code?: string
}

const COR_PADRAO = '#0E4F5C'
const COR_VALIDA = /^#[0-9a-f]{6}$/i

export const escapeHtml = (texto: string): string =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** Sem quebra de linha de nenhum tipo: serve para assunto e nomes. */
export const umaLinha = (texto: string): string => texto.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()

export const semControle = (texto: string): string => texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

/** Texto de uma linha limpo de controle: o que entra em assunto, saudação e cabeçalho. */
export const limpo = (texto: string): string => umaLinha(semControle(texto))

const INK = '#1f2933'
const SOFT = '#52606d'

/** Cores do cabeçalho: a cor da conta como fundo e o texto (claro ou escuro) com contraste garantido pelo tema. */
function headerColors(color: string): { bg: string; fg: string } {
  const valid = COR_VALIDA.test(color) ? color : COR_PADRAO
  const { vars } = deriveTheme({ primary: valid, accent: valid, material: 'ENAMEL', paper: 'WHITE', fontPair: 'CLASSIC' })
  return { bg: vars['--cover'], fg: vars['--on-cover'] }
}

export function emailFrame(brand: Brand, title: string, content: FrameContent): { text: string; html: string } {
  const name = limpo(brand.name)
  const footer = `Você recebeu este e-mail de ${name}.`
  const rows = content.rows ?? []
  const text = [
    name,
    '',
    title,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(rows.length > 0 ? [...rows.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(content.code ? [`Código: ${content.code}`, ''] : []),
    '--',
    footer,
  ]
    .join('\n')
    .trim()
  const { bg, fg } = headerColors(brand.color)
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${INK}">${escapeHtml(p)}</p>`)
    .join('')
  const table =
    rows.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border-collapse:collapse">` +
        rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;font-size:14px;line-height:1.4;color:${SOFT};vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
              `<td style="padding:6px 0;font-size:16px;line-height:1.4;color:${INK};vertical-align:top">${escapeHtml(v)}</td></tr>`,
          )
          .join('') +
        `</table>`
      : ''
  const code = content.code
    ? `<p style="margin:0 0 16px;font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:700;color:${INK};font-family:Menlo,Consolas,monospace">${escapeHtml(content.code)}</p>`
    : ''
  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f5f7"><div style="max-width:600px;margin:0 auto;padding:16px">` +
    `<div style="background:${bg};color:${fg};padding:16px 24px;font-size:16px;line-height:1.4;font-weight:700">${escapeHtml(name)}</div>` +
    `<div style="background:#ffffff;padding:24px">` +
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK}">${escapeHtml(title)}</h1>` +
    `${paragraphs}${table}${code}</div>` +
    `<p style="margin:16px 0 0;font-size:13px;line-height:1.4;color:${SOFT}">${escapeHtml(footer)}</p></div></body></html>`
  return { text, html }
}
