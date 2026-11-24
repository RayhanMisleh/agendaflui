import { addDays, isLocalDate } from '@/server/time'

export const ATALHOS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7dias', label: '7 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes-passado', label: 'Mês passado' },
] as const

export type Atalho = (typeof ATALHOS)[number]['id']

/** Período em datas locais da conta (inclusive nas duas pontas); `atalho` é `null` quando a pessoa digitou o intervalo. */
export type Periodo = { from: string; to: string; atalho: Atalho | null }

const ehAtalho = (v: string | undefined): v is Atalho => ATALHOS.some((a) => a.id === v)

/** O primeiro dia do mês de uma data local `AAAA-MM-DD` (só texto: nada de `Date`). */
const primeiroDoMes = (data: string): string => `${data.slice(0, 8)}01`

function doAtalho(atalho: Atalho, hoje: string): Periodo {
  switch (atalho) {
    case 'hoje':
      return { from: hoje, to: hoje, atalho }
    case '7dias':
      return { from: addDays(hoje, -6), to: hoje, atalho }
    case 'mes':
      return { from: primeiroDoMes(hoje), to: hoje, atalho }
    case 'mes-passado': {
      const ultimo = addDays(primeiroDoMes(hoje), -1)
      return { from: primeiroDoMes(ultimo), to: ultimo, atalho }
    }
  }
}

/**
 * O período que a URL pede, no calendário da conta (`hoje` vem do servidor). Intervalo livre (`de`/`ate`) vence o atalho;
 * com só uma ponta, a outra é o mesmo dia. Sem nada válido, o mês até hoje. Quem confere o teto de dias é o domínio.
 */
export function periodoDaUrl(p: { atalho?: string; de?: string; ate?: string }, hoje: string): Periodo {
  const de = p.de !== undefined && isLocalDate(p.de) ? p.de : null
  const ate = p.ate !== undefined && isLocalDate(p.ate) ? p.ate : null
  if (de !== null || ate !== null) return { from: de ?? (ate as string), to: ate ?? (de as string), atalho: null }
  return doAtalho(ehAtalho(p.atalho) ? p.atalho : 'mes', hoje)
}
