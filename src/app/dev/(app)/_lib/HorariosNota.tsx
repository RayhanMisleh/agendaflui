import { PLATFORM_TIME_ZONE_NAME } from './format'

/** Diz o fuso das datas da tela, por extenso, uma vez por tela. */
export function HorariosNota() {
  return <p className="af-section__help">Horários de {PLATFORM_TIME_ZONE_NAME}.</p>
}
