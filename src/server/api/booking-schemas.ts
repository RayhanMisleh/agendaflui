import { z } from '@/server/domain/errors'
import { isoInstant, uuid } from './wire'

/*
 * Esquemas de resposta (formato de fio) das rotas públicas e do cliente. Descrevem exatamente o que sai: fora de
 * produção, campo a mais na resposta vira erro. Os campos internos (comissão, anotações) não existem aqui.
 */

export const serviceSchema = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string(),
  priceCents: z.number(),
  durationMin: z.number(),
  rewardPoints: z.number(),
  clubOnly: z.boolean(),
  active: z.boolean(),
  displayOrder: z.number(),
  archived: z.boolean(),
})

export const professionalSchema = z.object({
  id: uuid,
  name: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  serviceIds: z.array(uuid),
})

export const slotSchema = z.object({ startsAt: isoInstant, label: z.string(), professionalIds: z.array(uuid) })

export const availabilitySchema = z.object({
  date: z.string(),
  durationMin: z.number(),
  totalCents: z.number(),
  slots: z.array(slotSchema),
})

export const availableDaySchema = z.object({ date: z.string(), weekday: z.string(), available: z.boolean() })

export const appointmentSchema = z.object({
  id: uuid,
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW']),
  source: z.enum(['APP', 'PANEL']),
  startsAt: isoInstant,
  endsAt: isoInstant,
  local: z.object({ date: z.string(), start: z.string(), end: z.string() }),
  customer: z.object({ id: uuid, name: z.string(), phoneLabel: z.string().nullable() }),
  professional: z.object({ id: uuid, name: z.string() }),
  items: z.array(z.object({ serviceId: uuid, name: z.string(), priceCents: z.number(), durationMin: z.number() })),
  totalCents: z.number(),
  totalDurationMin: z.number(),
  customerNote: z.string().nullable(),
  change: z.object({ allowed: z.boolean(), until: isoInstant.nullable(), untilLabel: z.string().nullable() }),
  canceledAt: isoInstant.nullable(),
  cancelReason: z.string().nullable(),
  completedAt: isoInstant.nullable(),
})

export const customerProfileSchema = z.object({
  id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneLabel: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  birthDate: z.string().nullable(),
  isClubMember: z.boolean(),
  origin: z.enum(['APP', 'PANEL']),
  hasAppAccess: z.boolean(),
  archived: z.boolean(),
  createdAt: isoInstant,
})

export const businessSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  timeZone: z.string(),
  brand: z.object({
    logoUrl: z.string().nullable(),
    symbolUrl: z.string().nullable(),
    primary: z.string(),
    accent: z.string(),
    material: z.enum(['LEATHER', 'LINEN', 'WOOD', 'ENAMEL']),
    paper: z.enum(['WHITE', 'CREAM', 'GRAY']),
    fontPair: z.enum(['CLASSIC', 'MODERN', 'FRIENDLY']),
    tokens: z.record(z.string(), z.string()),
  }),
  terms: z.object({
    professional: z.object({ singular: z.string(), plural: z.string() }),
    customer: z.object({ singular: z.string(), plural: z.string() }),
    points: z.object({ singular: z.string(), plural: z.string() }),
    club: z.string(),
  }),
  modules: z.object({ loyalty: z.boolean(), banners: z.boolean(), store: z.boolean(), vouchers: z.boolean() }),
  rules: z.object({
    slotStepMin: z.number(),
    minLeadMin: z.number(),
    maxAdvanceDays: z.number(),
    customerChangeWindowMin: z.number(),
  }),
})

/** Lista de ids separados por vírgula na consulta (`?serviceIds=a,b`). Cada id é validado pelo domínio. */
export const idListText = z.string().max(500)

export function splitIds(text: string): string[] {
  return text.split(',').map((id) => id.trim())
}
