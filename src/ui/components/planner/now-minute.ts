/**
 * O minuto do "agora" na tela: o minuto que o servidor informou mais os minutos inteiros que passaram desde que ele chegou.
 * `chegouEm` e `agoraMs` são relógios monotônicos do navegador (sem fuso). Quando o servidor manda um minuto novo, a chegada
 * é registrada de novo e a conta recomeça. Relógio que volta nunca devolve minuto anterior ao do servidor.
 */
export function nowMinute(inicial: number | null, chegouEm: number, agoraMs: number): number | null {
  if (inicial === null) return null
  return inicial + Math.max(0, Math.floor((agoraMs - chegouEm) / 60_000))
}
