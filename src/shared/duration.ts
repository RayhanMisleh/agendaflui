/** Duração em minutos como texto curto: `45 min`, `1 h`, `1 h 30`. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`
}
