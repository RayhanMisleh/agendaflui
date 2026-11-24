import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const ARQUIVO_DO_TOKEN = 'src/server/calendar/token.ts'
/** Só o envio e a ligação da agenda abrem o token de renovação. A mesma lista vive no ESLint (`semTokenDaAgenda`). */
const PASTAS_LIBERADAS = ['src/server/calendar/']
/** Texto entre aspas cujo caminho termina em `calendar/token` (ou `./token` dentro da própria pasta), com ou sem extensão. */
const REFERENCIA = /['"`][^'"`\n]*\/(?:calendar\/)?token(?:\.[cm]?[jt]sx?)?['"`]/
/** Quem está fora da pasta só alcança o leitor pelo caminho com `calendar/token`. */
const FORA = /\bcalendar\/token(?:\.[cm]?[jt]sx?)?['"`]/
const REEXPORTACAO = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"`][^'"`\n]*\/token(?:\.[cm]?[jt]sx?)?['"`]/

function arquivos(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.includes('db/generated/'))
    .map((f) => relative(RAIZ, join(pasta, f)).split('\\').join('/'))
}

/** Os arquivos (fora o próprio leitor) que citam `calendar/token` em import, require, import() ou texto. */
function importadores(): string[] {
  return arquivos(SRC).filter((f) => f !== ARQUIVO_DO_TOKEN && FORA.test(readFileSync(join(RAIZ, f), 'utf8')))
}

describe('quem pode importar o leitor do token da agenda', () => {
  test('o leitor existe onde o teste espera', () => {
    expect(arquivos(SRC)).toContain(ARQUIVO_DO_TOKEN)
  })

  test('a varredura reconhece import estático, dinâmico, relativo e reexportação', () => {
    for (const amostra of [
      "import { x } from '@/server/calendar/token'",
      "const m = await import('../calendar/token')",
      'const m = require("./token")',
      "import { x } from './token.ts'",
    ]) {
      expect(REFERENCIA.test(amostra), amostra).toBe(true)
    }
    expect(REFERENCIA.test("import { y } from '@/server/calendar/worker'")).toBe(false)
    for (const amostra of ["export { x } from './token'", "export * from '@/server/calendar/token.js'", "export type { X } from './token'"]) {
      expect(REEXPORTACAO.test(amostra), amostra).toBe(true)
    }
  })

  test('nenhum arquivo de src fora de server/calendar o importa', () => {
    const indevidos = importadores().filter((f) => !PASTAS_LIBERADAS.some((p) => f.startsWith(p)))
    expect(indevidos).toEqual([])
  })

  test('nenhum arquivo reexporta o leitor, em pasta nenhuma', () => {
    const reexportam = arquivos(SRC).filter((f) => f.startsWith('src/server/calendar/') && REEXPORTACAO.test(readFileSync(join(RAIZ, f), 'utf8')))
    expect(reexportam).toEqual([])
  })

  test('telas, ações, rotas e a camada de integrações não o importam', () => {
    for (const f of importadores()) {
      expect(f.startsWith('src/app/'), f).toBe(false)
      expect(f.startsWith('src/ui/'), f).toBe(false)
      expect(f.startsWith('src/server/integrations/'), f).toBe(false)
    }
  })
})
