// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { BrandPreview } from '@/ui/components/BrandPreview'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import { previewTheme } from '@/shared/theme/preview'

const marca = { primary: '#7A1F2B', accent: '#E0A030', material: 'LEATHER', paper: 'CREAM', fontPair: 'MODERN' } as const
const termos = { professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores' }

test('aplica os tokens de previewTheme no elemento raiz, sem vazar para a página', () => {
  render(<BrandPreview brand={marca} terms={termos} businessName="Pata Viva" />)
  const raiz = screen.getByTestId('brand-preview')
  const { tokens, theme } = previewTheme(marca)
  for (const [variavel, valor] of Object.entries(tokens)) expect(raiz.style.getPropertyValue(variavel)).toBe(valor)
  expect(raiz).toHaveAttribute('data-material', theme.material)
  expect(raiz).toHaveAttribute('data-font', theme.fontPair)
  expect(document.documentElement.style.getPropertyValue('--cover')).toBe('')
})

test('mostra o nome do negócio e os termos da conta na ficha e nas abas', () => {
  render(<BrandPreview brand={marca} terms={termos} businessName="Pata Viva" />)
  expect(screen.getAllByText('Pata Viva').length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Tosador/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Tutor/).length).toBeGreaterThan(0)
  expect(screen.getByText('Confirmado')).toBeInTheDocument()
})

test('muda com a marca: outra cor e outro termo atualizam a prévia', () => {
  const { rerender } = render(<BrandPreview brand={marca} terms={termos} businessName="Pata Viva" />)
  rerender(<BrandPreview brand={{ ...marca, primary: '#1F4E7A', material: 'WOOD' }} terms={{ ...termos, professionalSingular: 'Barbeiro', professionalPlural: 'Barbeiros' }} businessName="Pata Viva" />)
  const raiz = screen.getByTestId('brand-preview')
  expect(raiz.style.getPropertyValue('--cover')).toBe(previewTheme({ ...marca, primary: '#1F4E7A', material: 'WOOD' }).tokens['--cover'])
  expect(raiz).toHaveAttribute('data-material', 'wood')
  expect(screen.getAllByText(/Barbeiro/).length).toBeGreaterThan(0)
  expect(screen.queryByText(/Tosador/)).toBeNull()
})

test('os avisos do motor aparecem em texto ao lado da prévia', () => {
  const extrema = { ...marca, primary: '#FFFFFF' }
  const { warnings } = previewTheme(extrema)
  expect(warnings.length).toBeGreaterThan(0)
  render(<BrandPreview brand={extrema} terms={termos} businessName="Pata Viva" />)
  for (const w of warnings) expect(screen.getByText(THEME_WARNING_TEXT[w])).toBeInTheDocument()
})

test('cor incompleta usa a cor padrão e avisa que o formato está errado', () => {
  render(<BrandPreview brand={{ ...marca, primary: '#7A1' }} terms={termos} businessName="Pata Viva" />)
  expect(screen.getByText(THEME_WARNING_TEXT.invalid_color)).toBeInTheDocument()
})

test('sem aviso nenhum, a lista de avisos não existe', () => {
  render(<BrandPreview brand={marca} terms={termos} businessName="Pata Viva" />)
  expect(previewTheme(marca).warnings).toEqual([])
  expect(screen.queryByRole('list', { name: 'Avisos da marca' })).toBeNull()
})

test('a miniatura não é interativa: fora do foco e escondida de leitor de tela, com resumo em texto', () => {
  render(<BrandPreview brand={marca} terms={termos} businessName="Pata Viva" />)
  expect(screen.getByTestId('brand-preview-mock')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByTestId('brand-preview-mock')).toHaveAttribute('inert')
  expect(screen.getByRole('group', { name: 'Prévia do painel de Pata Viva' })).toBeInTheDocument()
})

test('com logo, mostra a imagem com o nome como texto alternativo', () => {
  render(<BrandPreview brand={{ ...marca, logoUrl: 'data:image/png;base64,AAAA' }} terms={termos} businessName="Pata Viva" />)
  expect(screen.getByRole('img', { name: 'Pata Viva', hidden: true })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})
