import { formatDateTime } from '@/server/time'

/** Fuso das telas da plataforma: um só, para todas as datas e horas que o painel dev mostra. */
export const PLATFORM_TIME_ZONE = 'America/Sao_Paulo'

/** Instante no fuso da plataforma, como `16/11/2026 12:30`. */
export function quando(instant: Date): string {
  return formatDateTime(instant, PLATFORM_TIME_ZONE)
}

const UM_DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** Tamanho em unidade legível (B, KB, MB, GB, TB), com vírgula decimal. */
export function tamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`
  const unidades = ['KB', 'MB', 'GB', 'TB']
  let valor = bytes
  let i = -1
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i++
  }
  return `${UM_DECIMAL.format(valor)} ${unidades[i]}`
}
