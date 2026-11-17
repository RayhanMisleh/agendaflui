'use client'
import { useMemo, useState } from 'react'
import { CalendarDays, ChartColumn, Gift, House, Scissors, Settings, UserRound, Users } from 'lucide-react'
import { Button, Checkbox, ColorField, Field, Input, Paper, Select, ToastProvider } from '@/ui/components'
import { ACCENT_FIELD_LABEL, FONT_PAIR_FIELD_LABEL, FONT_PAIR_OPTIONS, GROUND_FIELD_LABEL, GROUND_OPTIONS, PRIMARY_FIELD_LABEL, SIDEBAR_FIELD_LABEL, SIDEBAR_OPTIONS } from '@/shared/theme/labels'
import { PainelShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'
import { normalizeHex } from '@/ui/theme/color'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { THEME_WARNING_TEXT, deriveTheme } from '@/ui/theme/derive'
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
    brand: { primary: '#2F7D5B', accent: '#F29A4B', material: 'LEATHER', paper: 'CREAM', fontPair: 'FRIENDLY' },
    scenario: 'pet',
  },
  {
    label: 'Barbearia',
    name: 'Navalha Real',
    brand: { primary: '#243B6B', accent: '#E3A72F', material: 'WOOD', paper: 'WHITE', fontPair: 'MODERN' },
    scenario: 'barbearia',
  },
  {
    label: 'Estúdio',
    name: 'Estúdio Maré',
    brand: { primary: '#7A3E8E', accent: '#F2B84B', material: 'LINEN', paper: 'WHITE', fontPair: 'CLASSIC' },
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

/** A página inteira de aprovação: formulário de marca ao lado de um painel de verdade. */
export function Showcase() {
  const first = PRESETS[3]!
  const [brand, setBrand] = useState<BrandInput>(first.brand)
  const [name, setName] = useState(first.name)
  const [kind, setKind] = useState<ScenarioKind>(first.scenario)
  const [primary, setPrimary] = useState(first.brand.primary)
  const [accent, setAccent] = useState(first.brand.accent)
  const [withLogo, setWithLogo] = useState(false)
  const [withSupport, setWithSupport] = useState(false)

  const theme = useMemo(() => deriveTheme(brand), [brand])
  const scenario = SCENARIOS[kind]
  const warnPrimary = theme.signals.includes('text_adjusted') ? THEME_WARNING_TEXT.text_adjusted : undefined
  const warnAccent = theme.signals.includes('accent_adjusted') ? THEME_WARNING_TEXT.accent_adjusted : undefined

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
            <ColorField label={PRIMARY_FIELD_LABEL} value={primary} onChange={(v) => changeColor('primary', v)} {...(warnPrimary ? { warning: warnPrimary } : {})} />
            <ColorField label={ACCENT_FIELD_LABEL} value={accent} onChange={(v) => changeColor('accent', v)} {...(warnAccent ? { warning: warnAccent } : {})} />
            <Field label={SIDEBAR_FIELD_LABEL} hint={SIDEBAR_OPTIONS.find((o) => o.value === brand.material)?.hint}>
              <Select value={brand.material} onChange={(e) => setBrand({ ...brand, material: e.target.value as CoverMaterial })}>
                {SIDEBAR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={GROUND_FIELD_LABEL}>
              <Select value={brand.paper} onChange={(e) => setBrand({ ...brand, paper: e.target.value as PaperTone })}>
                {GROUND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={FONT_PAIR_FIELD_LABEL} hint={FONT_PAIR_OPTIONS.find((o) => o.value === brand.fontPair)?.hint}>
              <Select value={brand.fontPair} onChange={(e) => setBrand({ ...brand, fontPair: e.target.value as FontPair })}>
                {FONT_PAIR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
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
