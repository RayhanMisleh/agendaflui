import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const ARQUIVO_DOS_SEGREDOS = 'src/server/domain/platform/integration-secrets.ts'
/** Só o domínio da loja e o domínio de plataforma leem segredos de integração. */
const PASTAS_LIBERADAS = ['src/server/domain/store/', 'src/server/domain/platform/']
const REFERENCIA = /['"`][^'"`\n]*integration-secrets['"`]/

function arquivos(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))
    .map((f) => relative(RAIZ, join(pasta, f)).split('\\').join('/'))
}

/** Os arquivos (fora o próprio leitor) que citam `integration-secrets` em import, require, import() ou texto. */
function importadores(): string[] {
  return arquivos(SRC).filter((f) => f !== ARQUIVO_DOS_SEGREDOS && REFERENCIA.test(readFileSync(join(RAIZ, f), 'utf8')))
}

describe('quem pode importar o leitor de segredos de integração', () => {
  test('o leitor existe onde o teste espera', () => {
    expect(arquivos(SRC)).toContain(ARQUIVO_DOS_SEGREDOS)
  })

  test('a varredura reconhece import estático, dinâmico e relativo', () => {
    for (const amostra of [
      "import { x } from '@/server/domain/platform/integration-secrets'",
      "const m = await import('../platform/integration-secrets')",
      'const m = require("./integration-secrets")',
    ]) {
      expect(REFERENCIA.test(amostra), amostra).toBe(true)
    }
    expect(REFERENCIA.test("import { y } from '@/server/domain/platform/integrations'")).toBe(false)
  })

  test('nenhum arquivo de src fora de domain/store e domain/platform o importa', () => {
    const indevidos = importadores().filter((f) => !PASTAS_LIBERADAS.some((p) => f.startsWith(p)))
    expect(indevidos).toEqual([])
  })

  test('telas, ações, rotas e a camada de integrações não o importam', () => {
    for (const f of importadores()) {
      expect(f.startsWith('src/app/'), f).toBe(false)
      expect(f.startsWith('src/ui/'), f).toBe(false)
      expect(f.startsWith('src/server/api/'), f).toBe(false)
    }
  })
})
