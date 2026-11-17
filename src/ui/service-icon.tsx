import { Bath, Brush, Crown, Droplets, Flower2, Gem, Hand, Heart, Leaf, PawPrint, Palette, Scissors, Smile, Sparkles, Star, Stethoscope } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { isServiceIcon } from '@/shared/service-icons'
import type { ServiceIconName } from '@/shared/service-icons'

const ICONES: Record<ServiceIconName, LucideIcon> = {
  sparkles: Sparkles,
  scissors: Scissors,
  'paw-print': PawPrint,
  droplets: Droplets,
  bath: Bath,
  brush: Brush,
  heart: Heart,
  flower: Flower2,
  gem: Gem,
  smile: Smile,
  palette: Palette,
  hand: Hand,
  stethoscope: Stethoscope,
  star: Star,
  crown: Crown,
  leaf: Leaf,
}

/** O ícone de um serviço; nome desconhecido cai no brilho. Só enfeite: o nome do serviço sempre está ao lado. */
export function ServiceIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icone = isServiceIcon(name) ? ICONES[name] : Sparkles
  return <Icone size={size} aria-hidden="true" />
}
