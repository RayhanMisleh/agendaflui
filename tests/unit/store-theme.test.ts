import { contrastRatio } from '@/shared/theme/color'
import { AGENDAFLUI_BRAND } from '@/shared/theme/default-brand'
import { deriveTheme, type ThemeTokens } from '@/shared/theme/derive'
import { storeTheme } from '@/shared/theme/store-theme'

const CORES = ['#0B6E66', '#FFFF00', '#FFFFFF', '#000000', '#FF69B4', '#F5F5DC', '#7CFC00', '#FFD700', '#E0FFFF', '#8B0000', '#4B0082', '#FF7F50']
const tema = (primary: string): ThemeTokens => deriveTheme({ primary, accent: '#F2A93B', material: 'LEATHER' })

function pares(t: ThemeTokens): number[] {
  const v = t.vars
  return [
    contrastRatio(v['--on-brand'], v['--brand']),
    contrastRatio(v['--brand-text'], v['--ground']),
    contrastRatio(v['--brand-text'], v['--surface']),
    contrastRatio(v['--ink'], v['--brand-tint']),
  ]
}

describe('storeTheme', () => {
  test('cor da loja legível passa intacta', () => {
    const t = tema('#0B6E66')
    const r = storeTheme(t)
    expect(r.fellBack).toBe(false)
    expect(r.theme).toBe(t)
  })

  test('amarelo e branco, que o motor escurece para o texto, passam sem cair no tema Agenda Flui', () => {
    for (const c of ['#FFFF00', '#FFFFFF']) {
      const r = storeTheme(tema(c))
      expect(r.fellBack, c).toBe(false)
      expect(r.theme.vars['--brand']).toBe(c)
    }
  })

  test('tema que falha em um dos pares volta inteiro ao tema Agenda Flui, com fellBack', () => {
    const t = tema('#FFFF00')
    const quebrado: ThemeTokens = { ...t, vars: { ...t.vars, '--on-brand': t.vars['--brand'] } }
    const r = storeTheme(quebrado)
    expect(r.fellBack).toBe(true)
    expect(r.theme).toEqual(deriveTheme(AGENDAFLUI_BRAND))
    const texto: ThemeTokens = { ...t, vars: { ...t.vars, '--brand-text': t.vars['--ground'] } }
    expect(storeTheme(texto).fellBack).toBe(true)
    const bolha: ThemeTokens = { ...t, vars: { ...t.vars, '--ink': t.vars['--brand-tint'] } }
    expect(storeTheme(bolha).fellBack).toBe(true)
  })

  test('o tema devolvido sempre cumpre os quatro pares', () => {
    for (const c of CORES) {
      const { theme } = storeTheme(tema(c))
      for (const razao of pares(theme)) expect(razao, c).toBeGreaterThanOrEqual(4.5)
    }
  })
})
