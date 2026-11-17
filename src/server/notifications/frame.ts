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
  /** Botão em pílula na cor da conta. O endereço também vai por extenso, em texto logo abaixo do botão e na versão em texto puro. */
  action?: { label: string; href: string }
}

const COR_PADRAO = '#0B6E66'
const COR_VALIDA = /^#[0-9a-f]{6}$/i

export const escapeHtml = (texto: string): string =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** Sem quebra de linha de nenhum tipo: serve para assunto e nomes. */
export const umaLinha = (texto: string): string => texto.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()

export const semControle = (texto: string): string => texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

/** Texto de uma linha limpo de controle: o que entra em assunto, saudação e cabeçalho. */
export const limpo = (texto: string): string => umaLinha(semControle(texto))

// Sem fontes remotas: a pilha de fontes do sistema, na ordem que cada leitor de e-mail conhece.
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Cores da moldura, tiradas do tema da conta (os mesmos tokens do painel): cabeçalho na cor da conta com `on-brand`. */
function palette(color: string) {
  const valid = COR_VALIDA.test(color) ? color : COR_PADRAO
  const { vars } = deriveTheme({ primary: valid, accent: '#F2A93B', material: 'LEATHER', paper: 'CREAM', fontPair: 'CLASSIC' })
  return {
    bg: vars['--brand'],
    fg: vars['--on-brand'],
    tint: vars['--brand-tint'],
    ground: vars['--ground'],
    surface: vars['--surface'],
    line: vars['--line'],
    ink: vars['--ink'],
    soft: vars['--ink-muted'],
  }
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
    ...(content.action ? [`${content.action.label}: ${content.action.href}`, ''] : []),
    '--',
    footer,
  ]
    .join('\n')
    .trim()
  const c = palette(brand.color)
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${c.ink}">${escapeHtml(p)}</p>`)
    .join('')
  const table =
    rows.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border-collapse:collapse">` +
        rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;font-size:14px;line-height:1.4;color:${c.soft};vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
              `<td style="padding:6px 0;font-size:16px;line-height:1.4;color:${c.ink};vertical-align:top">${escapeHtml(v)}</td></tr>`,
          )
          .join('') +
        `</table>`
      : ''
  const code = content.code
    ? `<p style="margin:0 0 16px;padding:12px 16px;border-radius:10px;background:${c.tint};font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:700;color:${c.ink};font-family:Menlo,Consolas,monospace">${escapeHtml(content.code)}</p>`
    : ''
  const action = content.action
    ? `<p style="margin:8px 0 12px"><a href="${escapeHtml(content.action.href)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:16px;line-height:20px;font-weight:700;text-decoration:none">${escapeHtml(content.action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.4;color:${c.soft};word-break:break-all">${escapeHtml(content.action.href)}</p>`
    : ''
  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${c.ground};font-family:${FONT}"><div style="max-width:600px;margin:0 auto;padding:16px">` +
    `<div style="background:${c.bg};color:${c.fg};padding:16px 24px;border-radius:16px 16px 0 0;font-size:18px;line-height:1.4;font-weight:700;letter-spacing:-0.01em">${escapeHtml(name)}</div>` +
    `<div style="background:${c.surface};padding:24px;border:1px solid ${c.line};border-top:0;border-radius:0 0 16px 16px">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;letter-spacing:-0.01em;color:${c.ink}">${escapeHtml(title)}</h1>` +
    `${paragraphs}${table}${code}${action}</div>` +
    `<p style="margin:16px 0 0;font-size:13px;line-height:1.4;color:${c.soft}">${escapeHtml(footer)}</p></div></body></html>`
  return { text, html }
}
