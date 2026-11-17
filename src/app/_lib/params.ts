/** Um valor de parâmetro da URL: o primeiro, ou texto vazio. */
export function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

/** Texto fixo de um código vindo da URL. Só chave própria do mapa: `__proto__` e `constructor` não são códigos. */
export function porCodigo<T>(mapa: Readonly<Record<string, T>>, codigo: string): T | undefined {
  return Object.hasOwn(mapa, codigo) ? mapa[codigo] : undefined
}
