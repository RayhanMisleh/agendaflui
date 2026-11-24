import { TriangleAlert } from 'lucide-react'
import { previewTheme } from '@/shared/theme/preview'
import { labelOf, SIDEBAR_OPTIONS } from '@/shared/theme/labels'
import { themeAttrs } from '../theme/ThemeScope'
import { THEME_WARNING_TEXT } from '@/shared/theme/derive'
import type { CoverMaterial } from '@/shared/theme/derive'
import { Bubbles } from './Bubbles'
import { StatusBadge } from './StatusBadge'
import { cx } from './cx'

export type PreviewBrand = {
  primary: string
  accent: string
  material: CoverMaterial
  logoUrl?: string | null
}

/**
 * Miniatura do painel do negócio no desenho da marca: a barra lateral no estilo e na cor escolhidos (com a logo ou o nome),
 * o bloco "Hoje" na cor da conta com bolhas e o próximo atendimento num cartão branco, e a agenda com blocos cheios, um
 * em caramelo e uma vaga livre tracejada, tudo com os termos do sistema. Roda no navegador: usa `previewTheme` (o mesmo
 * motor do painel real) e aplica as variáveis no PRÓPRIO elemento, então nada vaza para a página. Os avisos do motor
 * aparecem em texto ao lado. A miniatura é só para olhar: fica fora do foco e escondida de leitor de tela, que recebe
 * um resumo em texto.
 */
export function BrandPreview({
  brand,
  businessName,
  className,
}: {
  brand: PreviewBrand
  businessName: string
  className?: string
}) {
  const { warnings, theme } = previewTheme(brand)
  const nome = businessName.trim() || 'Seu negócio'
  return (
    <div role="group" aria-label={`Prévia do painel de ${nome}`} className={cx('af-bp', className)}>
      <p className="af-sr">
        Miniatura do painel com a barra lateral {labelOf(SIDEBAR_OPTIONS, brand.material).toLowerCase()}.
        Ela muda sozinha quando você troca as cores, ou a barra lateral.
      </p>
      <div data-testid="brand-preview" className="af-bp__scope" {...themeAttrs(theme)}>
        <div data-testid="brand-preview-mock" aria-hidden="true" inert className="af-bp__window">
          <div className="af-bp__side">
            <div className="af-bp__brand">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a logo escolhida ainda não foi para o armazenamento
                <img src={brand.logoUrl} alt={nome} className="af-bp__logo" />
              ) : (
                <span className="af-bp__name">{nome}</span>
              )}
            </div>
            <ul className="af-bp__nav">
              <li className="af-bp__navitem af-bp__navitem--active">Agenda</li>
              <li className="af-bp__navitem">Clientes</li>
              <li className="af-bp__navitem">Profissionais</li>
            </ul>
          </div>
          <div className="af-bp__page">
            <div className="af-bp__today">
              <Bubbles on="brand" count={3} />
              <p className="af-bp__todaytitle">Hoje</p>
              <div className="af-bp__next">
                <span className="af-bp__hour">10:30</span>
                <span className="af-bp__what">
                  <strong>Banho e tosa</strong>
                  <span>Cliente: Ana Souza</span>
                  <span>Profissional: Marina</span>
                </span>
                <StatusBadge tone="confirmed">Confirmado</StatusBadge>
              </div>
            </div>
            <div className="af-bp__agenda">
              <span className="af-bp__block af-bp__block--brand">09:00 Thor</span>
              <span className="af-bp__block af-bp__block--accent">10:30 Mel</span>
              <span className="af-bp__block af-bp__block--brand">11:30 Bob</span>
              <span className="af-bp__block af-bp__block--free">Livre</span>
            </div>
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
