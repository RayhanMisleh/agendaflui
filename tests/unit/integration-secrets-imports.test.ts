import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const ARQUIVO_DOS_SEGREDOS = 'src/server/domain/platform/integration-secrets.ts'
/** Só o domínio da loja lê segredos de integração em texto (a Tarefa 7 o usa). A mesma lista vive no ESLint (`semSegredos`). */
const PASTAS_LIBERADAS = ['src/server/domain/store/']
/** Texto entre aspas cujo caminho termina em `/integration-secrets`, com ou sem extensão (`.js`, `.ts`, `.mjs`...). */
const REFERENCIA = /['"`][^'"`\n]*\/integration-secrets(?:\.[cm]?[jt]sx?)?['"`]/
/** Reexportação do leitor (`export * from`, `export { x } from`, `export type { x } from`): vale para qualquer pasta. */
const REEXPORTACAO = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"`][^'"`\n]*integration-secrets(?:\.[cm]?[jt]sx?)?['"`]/

function arquivos(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.includes('db/generated/'))
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

  test('a varredura reconhece caminho com extensão e reexportação', () => {
    for (const amostra of [
      "import { x } from '@/server/domain/platform/integration-secrets.js'",
      "import { x } from './integration-secrets.ts'",
      "const m = await import('../platform/integration-secrets.mjs')",
    ]) {
      expect(REFERENCIA.test(amostra), amostra).toBe(true)
    }
    for (const amostra of [
      "export { readMercadoPagoSecrets } from './integration-secrets'",
      "export * from './integration-secrets.js'",
      "export * as segredos from '@/server/domain/platform/integration-secrets'",
      "export type { X } from './integration-secrets'",
      "export {\n  a,\n  b,\n} from './integration-secrets'",
    ]) {
      expect(REEXPORTACAO.test(amostra), amostra).toBe(true)
    }
    expect(REEXPORTACAO.test("export const a = 1\nimport { y } from './integration-secrets'")).toBe(false)
  })

  test('nenhum arquivo de src fora de domain/store o importa (nem o resto de domain/platform)', () => {
    const indevidos = importadores().filter((f) => !PASTAS_LIBERADAS.some((p) => f.startsWith(p)))
    expect(indevidos).toEqual([])
  })

  test('nenhum arquivo reexporta o leitor, em pasta nenhuma', () => {
    const reexportam = arquivos(SRC).filter((f) => REEXPORTACAO.test(readFileSync(join(RAIZ, f), 'utf8')))
    expect(reexportam).toEqual([])
  })

  test('telas, ações, rotas e a camada de integrações não o importam', () => {
    for (const f of importadores()) {
      expect(f.startsWith('src/app/'), f).toBe(false)
      expect(f.startsWith('src/ui/'), f).toBe(false)
      expect(f.startsWith('src/server/api/'), f).toBe(false)
    }
  })
})
