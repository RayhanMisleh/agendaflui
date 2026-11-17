import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import type { BrandInput } from '@/ui/theme/derive'

export type DemoAccount = { id: string; label: string; name: string; brand: BrandInput; platform?: true }

/** A marca Agenda Flui e as contas de demonstração do seed (mais um estúdio com a barra Suave). */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'agendaflui', label: 'Agenda Flui', name: 'Agenda Flui', brand: AGENDAFLUI_BRAND, platform: true },
  {
    id: 'patas',
    label: 'Patas & Cia',
    name: 'Patas & Cia',
    brand: { primary: '#2F7D5B', accent: '#F29A4B', material: 'LEATHER', paper: 'CREAM', fontPair: 'FRIENDLY' },
  },
  {
    id: 'navalha',
    label: 'Navalha de Ouro',
    name: 'Navalha de Ouro',
    brand: { primary: '#243B6B', accent: '#E3A72F', material: 'WOOD', paper: 'WHITE', fontPair: 'MODERN' },
  },
  {
    id: 'estudio',
    label: 'Estúdio Maré',
    name: 'Estúdio Maré',
    brand: { primary: '#7A3E8E', accent: '#F2B84B', material: 'LINEN', paper: 'WHITE', fontPair: 'CLASSIC' },
  },
]
