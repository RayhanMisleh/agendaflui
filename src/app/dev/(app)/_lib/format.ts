import { formatDateTime } from '@/server/time'

/** Fuso das telas da plataforma: um só, para todas as datas e horas que o painel dev mostra. */
export const PLATFORM_TIME_ZONE = 'America/Sao_Paulo'

/** Instante no fuso da plataforma, como `16/11/2026 12:30`. */
export function quando(instant: Date): string {
  return formatDateTime(instant, PLATFORM_TIME_ZONE)
}

/**
 * Fração de requisições sem erro, arredondada para BAIXO na primeira casa do percentual: com erro nunca aparece 100,0%.
 * Sem requisições não há falha: 1.
 */
export function taxaDeSucesso(requests: number, errors: number): number {
  if (requests <= 0) return 1
  return Math.floor(((requests - Math.min(errors, requests)) * 1000) / requests) / 1000
}

/** Nome do fuso das telas, para a nota "Horários de Brasília" (uma vez por tela). */
export const PLATFORM_TIME_ZONE_NAME = 'Brasília'

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
