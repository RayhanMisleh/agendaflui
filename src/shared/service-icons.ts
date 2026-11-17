/** Os ícones que um serviço pode ter (nomes gravados no banco). O primeiro é o padrão do domínio. */
export const SERVICE_ICON_NAMES = [
  'sparkles',
  'scissors',
  'paw-print',
  'droplets',
  'bath',
  'brush',
  'heart',
  'flower',
  'gem',
  'smile',
  'palette',
  'hand',
  'stethoscope',
  'star',
  'crown',
  'leaf',
] as const
export type ServiceIconName = (typeof SERVICE_ICON_NAMES)[number]

export const SERVICE_ICON_LABELS: Record<ServiceIconName, string> = {
  sparkles: 'Brilho',
  scissors: 'Tesoura',
  'paw-print': 'Patinha',
  droplets: 'Gotas',
  bath: 'Banho',
  brush: 'Escova',
  heart: 'Coração',
  flower: 'Flor',
  gem: 'Joia',
  smile: 'Sorriso',
  palette: 'Cores',
  hand: 'Mão',
  stethoscope: 'Cuidado',
  star: 'Estrela',
  crown: 'Coroa',
  leaf: 'Folha',
}

export function isServiceIcon(name: string): name is ServiceIconName {
  return (SERVICE_ICON_NAMES as readonly string[]).includes(name)
}
