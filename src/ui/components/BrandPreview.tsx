import { TriangleAlert } from 'lucide-react'
import { previewTheme } from '@/shared/theme/preview'
import { labelOf, SIDEBAR_OPTIONS } from '@/shared/theme/labels'
import { themeAttrs } from '../theme/ThemeScope'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import type { CoverMaterial, FontPair, PaperTone } from '@/shared/theme/derive'
import { Paper } from './Paper'
import { Stamp } from './Stamp'
import { cx } from './cx'

export type PreviewTerms = {
  professionalSingular: string
  professionalPlural: string
  customerSingular: string
  customerPlural: string
}

export type PreviewBrand = {
  primary: string
  accent: string
  material: CoverMaterial
  paper: PaperTone
  fontPair: FontPair
  logoUrl?: string | null
}

/**
 * Miniatura fiel do painel do negócio: a barra lateral no estilo e na cor escolhidos (com o nome ou a logo em baixo-relevo),
 * o menu em divisórias, o papel com abas, uma ficha de agendamento com carimbo e o botão principal, tudo com os termos
 * da conta. Roda no navegador: usa `previewTheme` (o mesmo motor do painel real) e aplica as variáveis no PRÓPRIO
 * elemento, então nada vaza para a página. Os avisos do motor aparecem em texto ao lado. A miniatura é só para olhar:
 * fica fora do foco e escondida de leitor de tela, que recebe um resumo em texto.
 */
export function BrandPreview({
  brand,
  terms,
  businessName,
  className,
}: {
  brand: PreviewBrand
  terms: PreviewTerms
  businessName: string
  className?: string
}) {
  const { warnings, theme } = previewTheme(brand)
  const nome = businessName.trim() || 'Seu negócio'
  return (
    <div role="group" aria-label={`Prévia do painel de ${nome}`} className={cx('af-bp', className)}>
      <p className="af-sr">
        Miniatura do painel com a barra lateral {labelOf(SIDEBAR_OPTIONS, brand.material).toLowerCase()}.
        Ela muda sozinha quando você troca as cores, a barra lateral, o fundo, a fonte ou os termos.
      </p>
      <div data-testid="brand-preview" className="af-bp__scope" {...themeAttrs(theme)}>
        <div data-testid="brand-preview-mock" aria-hidden="true" inert className="af-bp__window">
          <div className="af-cover af-bp__cover" data-material={theme.material}>
            <div className="af-bp__brand">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a logo escolhida ainda não foi para o armazenamento
                <img src={brand.logoUrl} alt={nome} className="af-bp__logo" />
              ) : (
                <span className="af-bp__name af-engraved">{nome}</span>
              )}
            </div>
            <ul className="af-bp__nav">
              <li className="af-bp__tab af-bp__tab--active">Agenda</li>
              <li className="af-bp__tab">{terms.customerPlural || 'Clientes'}</li>
              <li className="af-bp__tab">{terms.professionalPlural || 'Profissionais'}</li>
            </ul>
          </div>
          <div className="af-bp__sheet">
            <p className="af-bp__title">Agenda do dia</p>
            <div className="af-bp__tabs">
              <span className="af-bp__ptab af-bp__ptab--active">Hoje</span>
              <span className="af-bp__ptab">Semana</span>
            </div>
            <Paper raised={2} className="af-bp__ficha">
              <span className="af-bp__hour">10:30</span>
              <span className="af-bp__what">
                <strong>Banho e tosa</strong>
                <span>
                  {terms.customerSingular || 'Cliente'}: Ana Souza
                </span>
                <span>
                  {terms.professionalSingular || 'Profissional'}: Marina
                </span>
              </span>
              <Stamp tone="ok">Confirmado</Stamp>
            </Paper>
            <span className="af-button af-button--primary af-button--sm af-bp__button">
              <span className="af-button__face">Novo agendamento</span>
            </span>
          </div>
        </div>
      </div>
      {warnings.length > 0 ? (
        <ul aria-label="Avisos da marca" className="af-bp__warnings">
          {warnings.map((w) => (
            <li key={w} className="af-bp__warning">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{THEME_WARNING_TEXT[w]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
