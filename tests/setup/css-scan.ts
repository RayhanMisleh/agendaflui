/** Varredura simples de CSS para os testes de movimento: sem comentários, com a pilha de @-blocos em volta de cada regra. */
export type Regra = { prelude: string; body: string; contexto: string[] }

/** Percorre os blocos `prelude { corpo }` (sem comentários), guardando os @-blocos que envolvem cada regra. */
export function regras(css: string, contexto: string[] = []): Regra[] {
  const out: Regra[] = []
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < texto.length) {
    const abre = texto.indexOf('{', i)
    if (abre === -1) break
    let fundo = 1
    let j = abre + 1
    while (j < texto.length && fundo > 0) {
      if (texto[j] === '{') fundo++
      else if (texto[j] === '}') fundo--
      j++
    }
    const prelude = texto.slice(i, abre).split(';').pop()!.trim()
    const body = texto.slice(abre + 1, j - 1)
    out.push({ prelude, body, contexto })
    if (prelude.startsWith('@')) out.push(...regras(body, [...contexto, prelude]))
    i = j
  }
  return out
}

/** As declarações `propriedade: valor` de um bloco, sem as dos blocos aninhados. */
export function declaracoes(body: string): [string, string][] {
  const semAninhados = body.replace(/\{[^{}]*\}/g, '')
  return semAninhados
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string])
}

export type Declaracao = { selector: string; prop: string; value: string; media: string[] }

/** Toda declaração de regra comum (fora de `@keyframes`), com o seletor e a pilha de @media em volta. */
export function scanCss(source: string): Declaracao[] {
  return regras(source)
    .filter((r) => !r.prelude.startsWith('@') && !r.contexto.some((c) => c.startsWith('@keyframes')))
    .flatMap((r) => declaracoes(r.body).map(([prop, value]) => ({ selector: r.prelude, prop, value, media: r.contexto })))
}

/** As propriedades usadas em cada `@keyframes`. */
export function keyframes(source: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const q of regras(source).filter((r) => r.prelude.startsWith('@keyframes'))) {
    out[q.prelude.replace('@keyframes', '').trim()] = regras(q.body).flatMap((p) => declaracoes(p.body).map(([prop]) => prop))
  }
  return out
}
