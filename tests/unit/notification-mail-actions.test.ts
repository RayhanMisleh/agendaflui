import { emailFrame } from '@/server/notifications/frame'
import { APP_LINE, renderAccessGranted, renderMemberInvite, renderOwnerInvite } from '@/server/notifications/render-invite'
import { renderPanelPasswordReset } from '@/server/notifications/render-password-reset'

const botao = (html: string, href: string) => new RegExp(`<a href="${href}" style="[^"]*border-radius:999px`).test(html)

describe('links de ação dos e-mails viram botão em pílula', () => {
  test('a moldura repete o endereço em texto logo abaixo do botão', () => {
    const f = emailFrame({ name: 'X', color: '#0B6E66' }, 'T', { paragraphs: [], action: { label: 'Abrir', href: 'https://exemplo.test/a?b=1&c=2' } })
    expect(f.html).toMatch(/<\/a><\/p><p[^>]*word-break:break-all[^>]*>https:\/\/exemplo\.test\/a\?b=1&amp;c=2<\/p>/)
    expect(f.text).toContain('Abrir: https://exemplo.test/a?b=1&c=2')
  })

  test('convite do dono', () => {
    const m = renderOwnerInvite({ ownerName: 'Ana', businessName: 'Patas', link: 'https://painel.test/definir-senha/tok', ttlDays: 7 })
    expect(botao(m.html, 'https://painel.test/definir-senha/tok')).toBe(true)
    expect(m.html).toContain('>Escolher minha senha</a>')
    expect(m.text).toContain('https://painel.test/definir-senha/tok')
    // o endereço não fica mais como parágrafo solto: só no botão e na linha abaixo dele
    expect(m.html.split('https://painel.test/definir-senha/tok').length - 1).toBe(2)
  })

  test('convite de equipe', () => {
    const m = renderMemberInvite({ name: 'Davi', businessName: 'Patas', roleLabel: 'Profissional', link: 'https://painel.test/definir-senha/t2', ttlDays: 7 })
    expect(botao(m.html, 'https://painel.test/definir-senha/t2')).toBe(true)
    expect(m.html).toContain('>Escolher minha senha</a>')
    expect(m.text).toContain('https://painel.test/definir-senha/t2')
  })

  test('aviso de acesso', () => {
    const m = renderAccessGranted({ ownerName: 'Ana', businessName: 'Patas', entryLink: 'https://painel.test/entrar' })
    expect(botao(m.html, 'https://painel.test/entrar')).toBe(true)
    expect(m.html).toContain('>Entrar em Patas</a>')
    expect(m.text).toContain('https://painel.test/entrar')
  })

  test('redefinição de senha', () => {
    const m = renderPanelPasswordReset({ name: 'Ana', link: 'https://painel.test/redefinir-senha/t3', ttlMin: 30 })
    expect(botao(m.html, 'https://painel.test/redefinir-senha/t3')).toBe(true)
    expect(m.html).toContain('>Redefinir minha senha</a>')
    expect(m.text).toContain('https://painel.test/redefinir-senha/t3')
  })
})

test('convite, dono e aviso de acesso citam o app, no texto e no HTML', () => {
  expect(APP_LINE).toBe('Baixe o app Agenda Flui para ver sua agenda no celular.')
  const mails = [
    renderMemberInvite({ name: 'Davi', businessName: 'Patas', roleLabel: 'Profissional', link: 'https://painel.test/definir-senha/t2', ttlDays: 7 }),
    renderOwnerInvite({ ownerName: 'Ana', businessName: 'Patas', link: 'https://painel.test/definir-senha/tok', ttlDays: 7 }),
    renderAccessGranted({ ownerName: 'Ana', businessName: 'Patas', entryLink: 'https://painel.test/entrar' }),
  ]
  for (const m of mails) {
    expect(m.text).toContain(APP_LINE)
    expect(m.html).toContain(APP_LINE)
  }
})
