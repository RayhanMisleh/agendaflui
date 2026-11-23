import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const RAIZ = resolve(__dirname, '../..')

function arquivosDe(caminho: string): string[] {
  const info = statSync(caminho, { throwIfNoEntry: false })
  if (!info) return []
  if (info.isFile()) return [caminho]
  return readdirSync(caminho).flatMap((nome) => arquivosDe(join(caminho, nome)))
}

/** Varre arquivos e pastas (relativos à raiz do painel) e devolve `caminho:linha` de cada linha que casa com `re`. */
export function arquivosCom(re: RegExp, caminhos: string[], exceto: string[] = []): string[] {
  const fora = exceto.map((e) => resolve(RAIZ, e))
  const achados: string[] = []
  for (const caminho of caminhos) {
    for (const arquivo of arquivosDe(resolve(RAIZ, caminho))) {
      if (fora.some((f) => arquivo === f || arquivo.startsWith(`${f}/`))) continue
      readFileSync(arquivo, 'utf8')
        .split('\n')
        .forEach((linha, i) => {
          if (re.test(linha)) achados.push(`${relative(RAIZ, arquivo)}:${i + 1}`)
        })
    }
  }
  return achados
}
