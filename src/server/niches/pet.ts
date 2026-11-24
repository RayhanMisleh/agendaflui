import { z } from '@/server/domain/errors'
import type { PriceVariant } from '@/server/db/generated/client'
import type { NicheDef, ServiceSuggestion, VariantPrice } from './types'

/** Preço e tempo na ordem dos portes: pequeno, médio, grande, gigante e gato. */
function precos(linhas: readonly [number, number][]): Record<PriceVariant, VariantPrice> {
  const [p, m, g, gg, gato] = linhas as [[number, number], [number, number], [number, number], [number, number], [number, number]]
  const v = ([priceCents, durationMin]: [number, number]): VariantPrice => ({ priceCents, durationMin })
  return { DOG_SMALL: v(p), DOG_MEDIUM: v(m), DOG_LARGE: v(g), DOG_GIANT: v(gg), CAT: v(gato) }
}

const sugestoes: readonly ServiceSuggestion[] = [
  {
    name: 'Banho',
    icon: 'bath',
    description: 'Banho com secagem e perfume.',
    prices: precos([[5000, 60], [6500, 60], [8500, 90], [11000, 120], [7000, 60]]),
  },
  {
    name: 'Banho e tosa',
    icon: 'scissors',
    description: 'Banho completo e tosa na máquina ou na tesoura.',
    prices: precos([[8000, 90], [10000, 120], [13000, 150], [17000, 180], [12000, 120]]),
  },
  {
    name: 'Tosa higiênica',
    icon: 'brush',
    description: 'Aparar barriga, patas e área íntima.',
    prices: precos([[4000, 30], [5000, 45], [6000, 45], [7500, 60], [5000, 45]]),
  },
  {
    name: 'Hidratação',
    icon: 'droplets',
    description: 'Máscara para deixar o pelo macio e brilhante.',
    prices: precos([[3500, 30], [4500, 30], [5500, 45], [7000, 45], [4500, 30]]),
  },
  {
    name: 'Corte de unha',
    icon: 'paw-print',
    description: 'Corte e lixa das unhas.',
    prices: precos([[2000, 15], [2000, 15], [2500, 15], [3000, 20], [2500, 15]]),
  },
]

export const PET_NICHE: NicheDef = {
  key: 'PET',
  label: 'Pet shop',
  subject: { singular: 'pet', plural: 'pets', add: 'Adicionar pet', empty: 'Nenhum pet ainda' },
  variants: [
    { key: 'DOG_SMALL', label: 'Cão pequeno', shortLabel: 'Pequeno', rangeLabel: 'até 10 kg', species: 'DOG', size: 'SMALL', needsOption: null },
    { key: 'DOG_MEDIUM', label: 'Cão médio', shortLabel: 'Médio', rangeLabel: '10 a 25 kg', species: 'DOG', size: 'MEDIUM', needsOption: null },
    { key: 'DOG_LARGE', label: 'Cão grande', shortLabel: 'Grande', rangeLabel: '25 a 45 kg', species: 'DOG', size: 'LARGE', needsOption: null },
    { key: 'DOG_GIANT', label: 'Cão gigante', shortLabel: 'Gigante', rangeLabel: 'acima de 45 kg', species: 'DOG', size: 'GIANT', needsOption: null },
    { key: 'CAT', label: 'Gato', shortLabel: 'Gato', rangeLabel: null, species: 'CAT', size: null, needsOption: 'servesCats' },
  ],
  optionsSchema: z.object({ servesCats: z.boolean() }),
  defaultOptions: { servesCats: false },
  quiz: [
    { key: 'name', title: 'Qual é o nome do seu pet?', optional: false, onlyIf: null },
    { key: 'species', title: 'Cão ou gato?', optional: false, onlyIf: 'servesCats' },
    { key: 'size', title: 'Qual é o porte?', optional: false, onlyIf: null },
    { key: 'breed', title: 'Qual é a raça?', optional: true, onlyIf: null },
    { key: 'age', title: 'Quantos anos, mais ou menos?', optional: true, onlyIf: null },
    { key: 'coat', title: 'Como é a pelagem?', optional: true, onlyIf: null },
    { key: 'care', title: 'Algum cuidado especial?', optional: true, onlyIf: null },
    { key: 'photo', title: 'Quer adicionar uma foto?', optional: true, onlyIf: null },
    { key: 'summary', title: 'Tudo certo?', optional: false, onlyIf: null },
  ],
  careQuickOptions: ['Medo de secador', 'Alergia', 'Agitado', 'Idoso'],
  breedSuggestions: {
    DOG: [
      'Sem raça definida', 'Shih-tzu', 'Poodle', 'Yorkshire', 'Lhasa apso', 'Spitz alemão', 'Maltês', 'Pinscher',
      'Bulldog francês', 'Golden retriever', 'Labrador', 'Border collie', 'Pastor alemão', 'Husky siberiano',
    ],
    CAT: ['Sem raça definida', 'Persa', 'Siamês', 'Maine coon', 'Angorá', 'Ragdoll', 'British shorthair'],
  },
  coatLabels: { SHORT: 'Curta', MEDIUM: 'Média', LONG: 'Longa' },
  serviceSuggestions: sugestoes,
}
