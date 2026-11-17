const curta = (data: string): string => `${data.slice(8, 10)}/${data.slice(5, 7)}`

/** O período em texto para a lista: "De 01/12 a 24/12", "De 01/12, sem fim", "Até 24/12" ou "Sem fim" quando não há datas. */
export function periodoEmTexto(startsOn: string | null, endsOn: string | null): string {
  if (startsOn !== null && endsOn !== null) return `De ${curta(startsOn)} a ${curta(endsOn)}`
  if (startsOn !== null) return `De ${curta(startsOn)}, sem fim`
  if (endsOn !== null) return `Até ${curta(endsOn)}`
  return 'Sem fim'
}
