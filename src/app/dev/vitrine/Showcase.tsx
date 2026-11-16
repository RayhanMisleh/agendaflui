'use client'
import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CalendarDays, ChartColumn, Gift, House, Scissors, Settings, TriangleAlert, UserRound, Users } from 'lucide-react'
import { Button, Checkbox, Field, Input, Paper, Select, ToastProvider } from '@/ui/components'
import type { InputProps } from '@/ui/components'
import { PainelShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'
import { normalizeHex } from '@/ui/theme/color'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import type { BrandInput, CoverMaterial, FontPair, PaperTone } from '@/ui/theme/derive'
import { DemoAgenda, NewAppointmentButton } from './demo-agenda'
import { SCENARIOS } from './demo-data'
import type { ScenarioKind } from './demo-data'
import './vitrine.css'

type Preset = { label: string; name: string; brand: BrandInput; scenario: ScenarioKind }

const PRESETS: Preset[] = [
  {
    label: 'Pet shop',
    name: 'Mundo Animal',
    brand: { primary: '#2F6B4F', accent: '#E8833A', material: 'LINEN', paper: 'CREAM', fontPair: 'FRIENDLY' },
    scenario: 'pet',
  },
  {
    label: 'Barbearia',
    name: 'Navalha Real',
    brand: { primary: '#3A2A20', accent: '#C9A227', material: 'LEATHER', paper: 'WHITE', fontPair: 'CLASSIC' },
    scenario: 'barbearia',
  },
  { label: 'AgendaFlui', name: 'AgendaFlui', brand: AGENDAFLUI_BRAND, scenario: 'pet' },
]

const NAV: NavItem[] = [
  { href: '#inicio', label: 'Início', icon: House },
  { href: '#agenda', label: 'Agenda', icon: CalendarDays, active: true },
  { href: '#clientes', label: 'Clientes', icon: Users },
  { href: '#equipe', label: 'Equipe', icon: UserRound },
  { href: '#servicos', label: 'Serviços', icon: Scissors },
  { href: '#relatorios', label: 'Relatórios', icon: ChartColumn },
  { href: '#fidelidade', label: 'Fidelidade', icon: Gift, disabled: true },
  { href: '#configuracoes', label: 'Configurações', icon: Settings },
]

const MATERIALS: Array<[CoverMaterial, string]> = [
  ['LEATHER', 'Couro'],
  ['LINEN', 'Linho'],
  ['WOOD', 'Madeira'],
  ['ENAMEL', 'Esmalte'],
]
const PAPERS: Array<[PaperTone, string]> = [
  ['WHITE', 'Branco'],
  ['CREAM', 'Creme'],
  ['GRAY', 'Cinza'],
]
const FONTS: Array<[FontPair, string, string]> = [
  ['CLASSIC', 'Clássico', 'Títulos com serifa de livro-caixa.'],
  ['MODERN', 'Moderno', 'Títulos sem serifa, de traço limpo.'],
  ['FRIENDLY', 'Amigável', 'Títulos de cantos redondos.'],
]

/** Logo e símbolo de exemplo, desenhados na hora: a vitrine mostra o baixo-relevo e o símbolo sem depender de arquivo. */
function svgUri(corpo: string, w: number, h: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${corpo}</svg>`)}`
}
function demoLogo(nome: string): string {
  const texto = nome.replace(/[<>&"']/g, '').slice(0, 14)
  return svgUri(
    `<circle cx="22" cy="24" r="16" fill="#fff"/><path d="M14 26l6 6 12-14" fill="none" stroke="#333" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><text x="46" y="32" font-family="Georgia,serif" font-size="22" font-weight="700" fill="#fff">${texto}</text>`,
    230,
    48,
  )
}
const DEMO_SIMBOLO = svgUri('<rect width="48" height="48" rx="10" fill="#fff"/><path d="M12 26l8 8 16-18" fill="none" stroke="#333" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>', 48, 48)

function parseHex(raw: string): string | null {
  try {
    return normalizeHex(raw)
  } catch {
    return null
  }
}

/** Campo de texto com a amostra da cor dentro, à direita. Repassa id e aria-* ao Input (o Field os injeta). */
function SwatchInput({ hex, ...rest }: InputProps & { hex: string | null }) {
  return (
    <span className="vt-swatchinput">
      <Input {...rest} className="vt-swatchinput__input" autoComplete="off" spellCheck={false} />
      <span className="vt-swatch" aria-hidden="true">
        <span className="vt-swatch__chip" style={{ background: hex ?? 'transparent' }} />
      </span>
    </span>
  )
}

function ColorField(p: {
  label: string
  value: string
  onChange: (raw: string) => void
  warning: string | undefined
}) {
  const hex = parseHex(p.value)
  return (
    <div className="vt-color">
      <Field label={p.label} error={hex ? undefined : 'Use uma cor no formato #RRGGBB.'}>
        <SwatchInput hex={hex} value={p.value} onChange={(e: ChangeEvent<HTMLInputElement>) => p.onChange(e.target.value)} />
      </Field>
      {hex && p.warning ? (
        <p className="vt-warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{p.warning}</span>
        </p>
      ) : null}
    </div>
  )
}

/** A página inteira de aprovação: formulário de marca ao lado de um painel de verdade. */
export function Showcase() {
  const first = PRESETS[2]!
  const [brand, setBrand] = useState<BrandInput>(first.brand)
  const [name, setName] = useState(first.name)
  const [kind, setKind] = useState<ScenarioKind>(first.scenario)
  const [primary, setPrimary] = useState(first.brand.primary)
  const [accent, setAccent] = useState(first.brand.accent)
  const [withLogo, setWithLogo] = useState(false)
  const [withSupport, setWithSupport] = useState(false)

  const theme = useMemo(() => deriveTheme(brand), [brand])
  const scenario = SCENARIOS[kind]
  const warnPrimary = theme.warnings.find((w) => w.startsWith('A cor principal'))
  const warnAccent = theme.warnings.find((w) => w.startsWith('A cor de destaque'))

  function apply(p: Preset) {
    setBrand(p.brand)
    setName(p.name)
    setKind(p.scenario)
    setPrimary(p.brand.primary)
    setAccent(p.brand.accent)
  }
  function changeColor(key: 'primary' | 'accent', raw: string) {
    if (key === 'primary') setPrimary(raw)
    else setAccent(raw)
    const hex = parseHex(raw)
    if (hex) setBrand((b) => ({ ...b, [key]: hex }))
  }

  return (
    <ToastProvider>
      <div className="vt-grid">
        <Paper as="aside" raised={1} className="vt-form-panel" aria-labelledby="vt-marca">
          <h2 id="vt-marca" className="vt-h2">
            Marca
          </h2>
          <div className="vt-presets" role="group" aria-label="Marcas prontas">
            {PRESETS.map((p) => (
              <Button key={p.label} onClick={() => apply(p)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="vt-fields">
            <Field label="Nome do negócio">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <ColorField label="Cor principal" value={primary} onChange={(v) => changeColor('primary', v)} warning={warnPrimary} />
            <ColorField label="Cor de destaque" value={accent} onChange={(v) => changeColor('accent', v)} warning={warnAccent} />
            <Field label="Material da capa">
              <Select value={brand.material} onChange={(e) => setBrand({ ...brand, material: e.target.value as CoverMaterial })}>
                {MATERIALS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tom do papel">
              <Select value={brand.paper} onChange={(e) => setBrand({ ...brand, paper: e.target.value as PaperTone })}>
                {PAPERS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Par de fontes" hint={FONTS.find(([v]) => v === brand.fontPair)?.[2]}>
              <Select value={brand.fontPair} onChange={(e) => setBrand({ ...brand, fontPair: e.target.value as FontPair })}>
                {FONTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="vt-fields">
            <Checkbox label="Mostrar logo e símbolo (baixo-relevo)" checked={withLogo} onChange={(e) => setWithLogo(e.target.checked)} />
            <Checkbox label="Mostrar a faixa de suporte" checked={withSupport} onChange={(e) => setWithSupport(e.target.checked)} />
          </div>
        </Paper>

        <div
          className="vt-preview"
          onClickCapture={(e) => {
            // A demonstração não navega: os links do menu só existem para mostrar o estado.
            if (e.target instanceof Element && e.target.closest('.af-shell__nav a, .af-more__list a')) e.preventDefault()
          }}
        >
          <PainelShell
            testId="demo-shell"
            embedded
            headingLevel={2}
            contentId="demo-conteudo"
            theme={theme}
            brand={{
              name: name.trim() || 'Seu negócio',
              logoUrl: withLogo ? demoLogo(name.trim() || 'Seu negócio') : null,
              symbolUrl: withLogo ? DEMO_SIMBOLO : null,
            }}
            {...(withSupport ? { supportBanner: `Você está em modo suporte na conta ${name.trim() || 'Seu negócio'}`, supportAction: <Button size="sm">Encerrar</Button> } : {})}
            nav={NAV}
            user={{ ...scenario.user, avatarUrl: null }}
            title="Agenda do dia"
            actions={<NewAppointmentButton scenario={scenario} />}
          >
            <DemoAgenda scenario={scenario} />
          </PainelShell>
        </div>
      </div>
    </ToastProvider>
  )
}
