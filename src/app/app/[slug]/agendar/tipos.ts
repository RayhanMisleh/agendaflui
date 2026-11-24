import type { PriceVariant } from '@/server/db/generated/client'
import type { Pedido } from '../_lib/consulta'
import type { DiaLivre, HorarioLivre, ProfissionalDaLista, ServicoDoPet } from './consultas'

/** O pet como o Agendar o mostra (só o que cabe no navegador). */
export type PetDoFluxo = {
  id: string
  name: string
  typeLabel: string
  rangeLabel: string | null
  variant: PriceVariant
  photoUrl: string | null
  /** Gato com gatos desligados não se agenda. */
  bookable: boolean
}

export type Consultas = {
  servicos: (petId: string) => Promise<Pedido<{ servicos: ServicoDoPet[] }>>
  profissionais: (serviceIds: string[]) => Promise<Pedido<{ profissionais: ProfissionalDaLista[] }>>
  dias: (q: { from: string; serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }) => Promise<Pedido<{ dias: DiaLivre[]; hasMore: boolean; proximo: string }>>
  horarios: (q: { date: string; serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }) => Promise<Pedido<{ horarios: HorarioLivre[] }>>
}
