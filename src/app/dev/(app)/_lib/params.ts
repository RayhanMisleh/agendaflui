/** Um valor de parâmetro da URL: o primeiro, ou texto vazio. */
export function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}
